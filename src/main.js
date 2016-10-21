'use strict';

require('dotenv').config();

const fs = require('fs-extra');

const Bluebird = require('bluebird');
const Discord = require('discord.js');
const Ivona = require('ivona-node');
const _ = require('lodash');

const SoundQueue = require('./SoundQueue');

Bluebird.promisifyAll(fs);

const {
  BOT_OWNER,
  DISCORD_TOKEN,
  IVONA_ACCESS_KEY,
  IVONA_SECRET_KEY,
} = process.env;

const ivona = new Ivona({
  accessKey: IVONA_ACCESS_KEY,
  secretKey: IVONA_SECRET_KEY,
});

const client = new Discord.Client();

const soundQueue = new SoundQueue(client, ivona);

client.on('ready', () => {
  console.log('ready');
});

function friendlyName(member) {
  return member.nickname || member.user.username;
}

client.on('voiceStateUpdate', (oldMember, newMember) => {
  if (oldMember.id === client.user.id) {
    console.log('ignoring bot event');

    return;
  }

  // TODO
  //
  // this should pause any current stream, if any, then perform this action,
  // then resume the paused stream
  if (oldMember.voiceChannel !== newMember.voiceChannel) {
    // It's better to wait a bit to allow the user to finish connecting.
    const GRACE_PERIOD = 1500;

    if (oldMember.voiceChannel) {
      client.setTimeout(() => {
        soundQueue.speak(`${friendlyName(oldMember)} has left the channel.`,
                         oldMember.voiceChannel);
      }, GRACE_PERIOD);
    }

    if (newMember.voiceChannel) {
      client.setTimeout(() => {
        soundQueue.speak(`${friendlyName(newMember)} has joined the channel.`,
                         newMember.voiceChannel);
      }, GRACE_PERIOD);
    }
  }
});

function command(prefixes, message, handler) {
  if (!Array.isArray(prefixes)) {
    prefixes = [prefixes];
  }

  // longest matches first, otherwise the shorter matches
  // will win out every time
  prefixes = prefixes.sort((a, b) => a.length < b.length);

  // construct regex once and capture it in closure
  // ['google', 'g'] becomes /^\.(?:google|g)\s+/
  const escaped = prefixes.map(_.escapeRegExp).join('|');
  const constructed = String.raw`^\.(?:${escaped})\s*`;
  const re = new RegExp(constructed);

  const matches = re.exec(message.content);

  if (matches) {
    const body = message.content.slice(matches[0].length);

    handler(message, body);
  }
}

client.on('message', message => {
  if (message.author.bot) {
    return;
  }

  const voiceChannel = client.channels.find('name', 'echodeck');

  if (message.author.id === BOT_OWNER) {
    command('lexicon', message, message => {
      message.channel.sendMessage('updating lexicon ...');

      fs.readFileAsync('./data/lexicon.pls', { encoding: 'utf8' })
        .then(content => {
          ivona.putLexicon('lexicon', content)
            // NOTE: ivona-node doesn't emit 'complete', use 'end'
            .on('end', () => {
              message.channel.sendMessage('lexicon successfully loaded');

              // Invalidate the speech cache.
              fs.removeAsync('./data/speech/')
                .finally(() => fs.mkdirs('./data/speech/'));
            });
        })
        .catch(e => {
          message.channel.sendMessage(e);
        });
    });

    command('demo', message, () => {
      const first = 'This is the first thing.';
      const second = 'And this is the second thing.';
      const third = 'And finally this is the third thing.';

      const rimshot = 'https://www.youtube.com/watch?v=oShTJ90fC34';
      const whatsThat = 'https://www.youtube.com/watch?v=HYNoFwLFqXM';
      const dereferencing = 'https://www.youtube.com/watch?v=bLHL75H_VEM';
      const yeah = 'https://www.youtube.com/watch?v=qj-Utu-dYTw';

      soundQueue.playLocal('others-bmo-exclaim.mp3', voiceChannel);

      soundQueue.speak(first, voiceChannel);
      soundQueue.playRemote(whatsThat, voiceChannel);

      soundQueue.speak(second, voiceChannel);
      soundQueue.playRemote(dereferencing, voiceChannel);

      soundQueue.speak(third, voiceChannel);
      soundQueue.playRemote(yeah, voiceChannel);

      soundQueue.playLocal('shutdown.mp3', voiceChannel);
      soundQueue.playRemote(rimshot, voiceChannel);
    });
  }

  command('say', message, (message, body) => {
    soundQueue.speak(body, voiceChannel);
  });

  command('play', message, (message, body) => {
    soundQueue.playRemote(body, voiceChannel);
  });

  command('skip', message, message => {
    soundQueue.skip();
    message.channel.sendMessage('sound queue skipped');
  });

  command('stop', message, message => {
    soundQueue.stop();
    message.channel.sendMessage('sound queue stopped');
  });

  command('pause', message, message => {
    soundQueue.pause();
    message.channel.sendMessage('sound queue paused');
  });

  command('resume', message, message => {
    soundQueue.resume();
    message.channel.sendMessage('sound queue resumed');
  });
});

client.on('guildMemberAdd', (guild, member) => {
  guild.defaultChannel.sendMessage(`${member.user.username} has joined this server`);
});

client.on('error', e => {
  console.error('[DISCORD] caught error:');
  console.error(e);
});

client.login(DISCORD_TOKEN);

process.on('SIGINT', () => {
  client.destroy()
    .then(() => {
      console.log('disconnected');
      process.exit();
    })
    .catch(() => {
      process.exit();
    });
});
