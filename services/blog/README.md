Ghost CMS for teh blog

Use https://github.com/zaxbux/ghost-storage-b2 for storage? (fronted by CloudFlare), but be sure to rewrite the public URL! Or just keep using cloudinary?

https://ghost.org/docs/search Need to add search

Note that we need special caching - cloudflare doesn't "cache everything" by default, that's something you need to turn on, not to mention the fact that you need to disable /ghost endpoint from being included!!

Can't protect it using Authelia because of domain...
