'use strict';

require('dotenv').config();

const Discord = require('discord.js');

const SoundQueue = require('./SoundQueue');

const {
  BOT_OWNER,
  DISCORD_TOKEN,
} = process.env;

const client = new Discord.Client();

const soundQueue = new SoundQueue(client);

client.on('ready', () => {
  console.log('ready');
});

client.on('voiceStateUpdate', (oldMember, newMember) => {
  if (oldMember.id === client.user.id) {
    console.log('ignoring bot event');

    return;
  }

  if (oldMember.voiceChannel !== newMember.voiceChannel) {
    // It's better to wait a bit to allow the user to finish connecting.
    const GRACE_PERIOD = 1000;

    if (oldMember.voiceChannel) {
      client.setTimeout(() => {
        soundQueue.speak(`${oldMember.user.username} has left the channel.`,
                         oldMember.voiceChannel);
      }, GRACE_PERIOD);
    }

    if (newMember.voiceChannel) {
      client.setTimeout(() => {
        soundQueue.speak(`${newMember.user.username} has joined the channel.`,
                         newMember.voiceChannel);
      }, GRACE_PERIOD);
    }
  }
});

client.on('message', message => {
  if (message.author.bot) {
    return;
  }

  if (message.author.id === BOT_OWNER) {
    if (message.content === 'ping') {
      console.log(message);
      message.reply('pong');
    }
  }
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
