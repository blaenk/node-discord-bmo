'use strict';

const fs = require('fs');
const path = require('path');
const stream = require('stream');
const crypto = require('crypto');
const events = require('events');
const childProcess = require('child_process');

const Bluebird = require('bluebird');
const request = require('request');
const ffmpeg = require('fluent-ffmpeg');
const moment = require('moment');

Bluebird.promisifyAll(fs);
Bluebird.promisifyAll(childProcess);

const FREQUENCY = 48000;
const FRAME_SIZE = 1920;
const CHANNELS = 2;
const FRAMES = 20;
const WATER_MARK = FRAME_SIZE * CHANNELS * FRAMES;

class SoundQueue extends events.EventEmitter {
  constructor(client, ivona) {
    super();

    this.client = client;
    this.ivona = ivona;

    this.isPlaying = false;
    this.queue = [];
  }

  enqueue(job) {
    job.createdAt = new Date();

    this.queue.push(job);

    console.log('enqueuing new job', this);

    if (!this.isPlaying) {
      this.processNext();
    }
  }

  processNext() {
    this.isPlaying = true;

    if (!this.client || this.queue.length === 0) {
      this.isPlaying = false;

      return;
    }

    const job = this.queue.shift();

    if (!job.channel) {
      this.isPlaying = false;

      return;
    }

    console.log(`going to play a job, ${this.queue.length} remaining`);

    const timeSinceCreated = moment.duration(moment().diff(moment(job.createdAt)));

    if (timeSinceCreated.minutes() > 1) {
      console.log(`playing job that is ${timeSinceCreated.humanize()} old`);
    }

    Bluebird.props({
      connection: job.channel.connection || job.channel.join(),
      stream: Bluebird.resolve(job.stream),
    })
      .then(({ connection, stream }) => {
        this.dispatcher = connection.playConvertedStream(this.toPCMStream(stream));

        this.dispatcher
          .on('error', e => {
            throw e;
          })
          .on('start', () => {
            console.log('stream start');
          })
          .once('end', () => {
            console.log('stream end');
            this.isPlaying = false;
            this.dispatcher = null;
            this.client.setTimeout(() => this.processNext(), 1);
          });
      });
  }

  stop() {
    if (this.dispatcher) {
      this.dispatcher.end();
      this.queue = [];
      this.isPlaying = false;
    }
  }

  skip() {
    if (this.dispatcher) {
      this.dispatcher.end();
    }
  }

  pause() {
    if (this.dispatcher) {
      this.dispatcher.pause();
    }
  }

  resume() {
    if (this.dispatcher) {
      this.dispatcher.resume();
    }
  }

  speak(text, channel) {
    this.enqueue({
      channel,
      stream: this.cacheStream('speech', text, () => this.speechStream(text)),
    });
  }

  // TODO
  //
  // the enqueue has to occur right away or risk ruining the order
  play(location, channel) {
    fs.statAsync(location)
      .then(_stat => {
        console.log('local');
        this.playLocal(location, channel);
      })
      .catch(_e => {
        console.log('remote');
        this.playRemote(location, channel);
      });
  }

  playLocal(filePath, channel) {
    if (path.dirname(filePath) === '.') {
      filePath = path.join('./data/sounds', filePath);
    }

    console.log(`playing local: ${filePath}`);

    this.enqueue({
      channel,
      stream: Bluebird.resolve(fs.createReadStream(filePath)),
    });
  }

  playRemote(url, channel) {
    this.enqueue({
      channel,
      stream: this.cacheStream('url', url, () => this.remoteAudioStream(url)),
    });
  }

  toPCMStream(input) {
    const convertedStream = new stream.PassThrough({ highWaterMark: WATER_MARK });

    ffmpeg(input)
      .outputFormat('s16le')
      .audioFrequency(FREQUENCY)
      .audioChannels(CHANNELS)
      .on('start', command => console.info(`[ffmpeg]: ${command}`))
      .on('error', (err, _stdout, _stderr) => {
        console.log('[ffmpeg]: Cannot process stream: ' + err.message);
      })
      .on('end', (_stdout, _stderr) => {
        console.log('[ffmpeg]: Transcoding succeeded !');
      })
      .stream(convertedStream);

    convertedStream.on('error', e => console.error('audiostream error', e));

    return convertedStream;
  }

  getRemoteAudioInfo(url) {
    const parameters = ['--get-title', '--get-url', '--format', 'bestaudio', url];

    return childProcess.execFileAsync('youtube-dl', parameters)
      .then(info => {
        const [title, url] = info.trim().split('\n');

        return { title, url };
      });
  }

  remoteAudioStream(url) {
    return this.getRemoteAudioInfo(url)
      .then(info => {
        console.log('info:', info);

        return request.get(info.url);
      });
  }

  // NOTE
  //
  // Using a lexicon is at odds with caching speech. For example, if we cache
  // the speech phrase "The house is white." and we specify a lexical alias of
  // "mansion" for "house", the cache key (input text) will remain the same even
  // though the speech should be different.
  //
  // Simply invalidate the entire speech cache when a lexicon is updated? This
  // would allow us to continue to use the cache in most cases.
  speechStream(text) {
    return Bluebird.resolve(new stream.Readable().wrap(this.ivona.createVoice(text, {
      body: {
        LexiconNames: ['lexicon'],
      },
    })));
  }

  cacheStream(namespace, identifier, streamFunction) {
    const cacheIdentifier = crypto.createHash('sha1').update(identifier).digest('hex');
    const cachedPath = path.join('./data', namespace, cacheIdentifier);

    return fs.statAsync(cachedPath)
      .then(_stat => {
        console.log('playing from cache:', cachedPath);

        return fs.createReadStream(cachedPath);
      })
      .catch(_e => {
        console.log('caching');

        const readStream = new stream.PassThrough({ highWaterMark: WATER_MARK });

        return streamFunction()
          .then(inputStream => {
            const cacheStream = fs.createWriteStream(cachedPath);

            cacheStream.on('finish', () => console.log('finished caching'));

            inputStream.pipe(cacheStream);
            inputStream.pipe(readStream);

            return readStream;
          });
      });
  }
}

module.exports = SoundQueue;
