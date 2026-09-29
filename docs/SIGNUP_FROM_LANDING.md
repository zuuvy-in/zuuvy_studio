# Signing up from the Zuuvy Sites landing page

The landing page's "Start your website" form sends visitors to the studio's
signup page with what they typed as URL parameters. Build it as a `form`
block whose destination is a URL (`{ "kind": "url", "url": "https://studio.zuuvy.site/signup" }`):
the form submits with GET, so each field's `name` becomes a parameter.

```
https://studio.zuuvy.site/signup?business=Asha+Bakes&name=Asha&email=asha@example.in
  &phone=98765+43210&kind=store&site=Asha+Bakes&tagline=Cakes+that+arrive+warm
  &prompt=A+bright+site+for+my+bakery+in+Patna&subdomain=ashabakes
```

| Parameter   | Meaning | Checked as |
|-------------|---------|------------|
| `business`  | Business name — fills the form | up to 80 characters |
| `name`      | Their name — fills the form | up to 80 |
| `email`     | Their email — fills the form | must look like an email |
| `phone`     | Goes on the starter site's contact section | digits, spaces, `+ ( ) -` |
| `kind`      | `landing`/`website`/`business`, `portfolio`, or `store`/`shop`/`ecommerce` | anything else is ignored |
| `site`      | The site's name (default **Default**) | up to 60 |
| `tagline`   | The starter site's tagline | up to 160 |
| `prompt`    | What to build — waits in the builder, plan first | up to 1000 |
| `subdomain` | Preferred address (`<subdomain>.zuuvy.site`) | normalised; a suffix is added if taken |

All are optional. When `kind`, `site`, `tagline`, `prompt` or `subdomain` is
present, signing up also creates the site and opens the builder with the prompt
filled in (or a one-liner made from the kind, business and tagline). Only the
name, business and email fill the form; the rest ride through as hidden fields.

An existing customer who follows the link and signs in instead is taken to the
new-site form, filled in — nothing is created without them confirming.

## Email verification

Every new account is emailed a link (`/verify-email?token=…`, valid 3 days;
sending again replaces the old link). Until it is used, nothing the account
does can go live: the starter site is created unpublished and **Publish** is
refused with a message saying why. The studio shows a banner with "Send the
link again". Accounts that existed before verification was introduced, and
ones the platform creates itself (admins, seed scripts), count as verified.
