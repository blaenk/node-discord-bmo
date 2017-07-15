'use strict';

const Bluebird = require('bluebird');

const request = require('request-promise');
const moment = require('moment');
const htmlparser = require('htmlparser2');

class Visitor {
  constructor() {
    this.text = [];
  }

  collectText(html) {
    this.text = [];
    this.visitNodes(html);

    return this.text.join('');
  }

  visitNode(node) {
    if (node === null) {
      return;
    }

    switch (node.type) {
      case 'text':
        this.visitText(node);
        break;

      case 'tag':
        this.visitTag(node);
        break;
    }
  }

  visitText(node) {
    this.text.push(node.data);
  }

  visitTag(node) {
    switch (node.name) {
      case 'a':
        this.visitLink(node);
        break;

      case 'p':
        this.visitParagraph(node);
        break;

      case 'code':
        this.visitCode(node);
        break;

      case 'i':
        this.visitItalic(node);
        break;

      default:
        this.visitChildren(node);
    }
  }

  visitNodes(nodes) {
    for (const node of nodes) {
      this.visitNode(node);
    }
  }

  visitChildren(node) {
    if (node.children) {
      this.visitNodes(node.children);
    }
  }

  visitLink(node) {
    this.text.push(node.attribs.href);
  }

  visitParagraph(node) {
    this.text.push('\n\n');
    this.visitChildren(node);
  }

  visitCode(node) {
    this.text.push('```\n');
    this.visitChildren(node);
    this.text.push('```');
  }

  visitItalic(node) {
    this.text.push('*');
    this.visitChildren(node);
    this.text.push('*');
  }
}

const htmlToMarkdown = html => {
  return new Bluebird((resolve, reject) => {
    const visitor = new Visitor();

    const handler = new htmlparser.DomHandler((error, dom) => {
      if (error) {
        reject(error);
      } else {
        resolve(visitor.collectText(dom));
      }
    });

    const parser = new htmlparser.Parser(handler, { decodeEntities: true });

    parser.write(html);
    parser.end();
  });
};

function hnItemUrl(id) {
  return `https://news.ycombinator.com/item?id=${id}`;
}

function hnUserUrl(name) {
  return `https://news.ycombinator.com/user?id=${name}`;
}

function getItem(id) {
  return request({
    url: `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
    json: true,
  });
}

function formatStory(post) {
  const date = `${moment.unix(post.time).fromNow()}`;

  return `<:ycombinator:239206737075240960> **${post.title}**
**${post.score}** points. **${post.descendants}** comments. posted ${date}

story: ${hnItemUrl(post.id)}
target: ${post.url}`;

//   return Bluebird.resolve({
//     fallback: post.title,
//     unfurl_links: true,
//     unfurl_media: true,
//     mrkdwn_in: ['pretext', 'text'],
//     title: post.title,
//     title_link: hnItemUrl(post.id),
//     text:
// `*${post.score}* points. *${post.descendants}* comments. posted by ${author} ${date}
// ${post.url}`
//   });
}

function findRootOf(id) {
  if (id === null) {
    return Bluebird.reject({ message: "couldn't find root" });
  }

  return getItem(id).then(item => {
    switch (item.type) {
      case 'story':
        return Bluebird.resolve(item);

      case 'comment':
        return findRootOf(item.parent);

      default:
        return Bluebird.reject({ message: "root isn't a story", root: item });
    }
  });
}

function formatComment(comment) {
  return Bluebird.join(htmlToMarkdown(comment.text), findRootOf(comment.parent),
  (text, root) => {
    const date = moment.unix(comment.time).fromNow();
    const storyUrl = hnItemUrl(root.id);
    const commentUrl = hnItemUrl(comment.id);

    return `<:ycombinator:239206737075240960> **${root.title}**
comment posted ${date} by ${comment.by}

:speech_left: **BEGIN QUOTE** :speech_balloon:

${text}

:speech_left: **END QUOTE** :speech_balloon:

story: ${storyUrl}
comment: ${commentUrl}`;

    // return {
    //   fallback: text,
    //   unfurl_links: true,
    //   unfurl_media: true,
    //   mrkdwn_in: ["pretext", "text"],
    //   author_name: comment.by,
    //   author_link: hnUserUrl(comment.by),
    //   author_icon: 'https://news.ycombinator.com/y18.gif',
    //   text: `_posted ${date} on ${title}_\n\n${text}`
    // };
  });
}

function unfurl(url) {
  const id = url.query.id;

  return getItem(id)
    .then(item => {
      console.log('item:', item);

      switch (item.type) {
        case 'story': return formatStory(item);
        case 'comment': return formatComment(item);
        default: return Bluebird.reject(new Error(id));
      }
    })
    .catch(e => console.error(e));
}

module.exports = {
  unfurl,
};
