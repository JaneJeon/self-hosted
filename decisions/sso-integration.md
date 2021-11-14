For web-only applications that do not have built-in authentication, oauth2-proxy is the _correct_ choice, full stop.

For applications that are _supposed_ to be public (e.g. analytics), we don't need to put anything on top.

> Actually, for _any_ applications, with or without builtin auth, there is always a risk that there's a bug in the application that would allow someone to compromise the application _without_ the credentials, and that's where VPNs would come in - they won't even let you REACH the applications without the right credentials.

> So technically, the correct answer is an SSO-integrated VPN (like Tailscale), but a VPN brings with it its own set of troubles, like DNS troubles (i.e. you don't get a "neat" DNS like janejeon.com unless you manually set it up), and HTTPS (reverse proxies don't play nice with it).

> One possible way we might be able to get around all of this bullshit is by routing everything with Traefik as usual - so we get the HTTPS and the DNS for "free" - but exposing it on a port that's _not_ accessible from the public! Then, through the magic of Tailscale DNS, I would be able to access \*.janejeon.dev through the VPN and hit Traefik that way?

There are private applications; however, all of them are (so far) web applications; anything that has mobile clients already seem to have auth baked-in, so no need for a VPN there.

Then, the only thing left are "infrastructure" pieces; those can be transparently connected using a VPN (esp. for databases where we'd like to be able to "login" directly with desktop database clients).

As for the difference between a full-on VPN (Tailscale) and something like Teleport, Tailscale is a transparent VPN, so once you connect, you're _fully_ connected, without the client needing to do anything special. However, this does mean that it can't do database-specific things.

Teleport is _built for_ SSH and database acces, but to access the databases using a GUI requires both the client and the database to be SSL cert-aware, at which point you may as well just use Vault directly (it is also database aware, so can do things like provisioning specific roles) to obtain credentials? Of course, you'd have to input them manually but...

Both Tailscale and Teleport get around NAT shit so that you don't have to configure things like firewalls, open ports, and stuff like that. Both of them only include GitHub for free tier.

Obviously, for "other things" like cloud resources, it only makes sense to use Vault to obtain secrets. The only reason we're even considering something else for internal resources is for the transparency a VPN brings, but Boundary connected with Vault may replace the need for both Teleport and Tailscale in the future.

For now, everything will be accessible via HTTP/HTTPS anyway, so there will be no "poking holes" necessary.

And for everything else, resort to Vault for only the things necessary (e.g. credentials for cloud and online infrastructure services), and Teleport for the "infra" pieces (for connectivity) - Tailscale doesn't let you exclude traffic from one device to another (it's user-based).
