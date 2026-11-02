# Upgraded libraries

The pages load these files from the official releases. They replace the versions
that the old server shipped (jQuery 2.1.1, Bootstrap 3.3.1), because those have
published XSS advisories.

- jQuery 3.7.1 from https://code.jquery.com/ (`jquery/dist/`), which fixes
  CVE-2015-9251, CVE-2019-11358, CVE-2020-11022, and CVE-2020-11023
  - `jquery.min.js` sha256 `fc9a93dd241f6b045cbff0481cf4e1901becd0e12fb45166a8f17f95823f0b1a`
  - `jquery.js` sha256 `78a85aca2f0b110c29e0d2b137e09f0a1fb7a8e554b499f740d6744dc8962cfe`
- Bootstrap 3.4.1 from https://github.com/twbs/bootstrap/releases/tag/v3.4.1
  (`bootstrap-3.4.1-dist.zip`, sha256 `d49793cf773cbd393ac2cf340c3b4ddab5365fa7c292098ac07e12eab3efd92e`,
  unpacked to `bootstrap/dist/`), which fixes CVE-2018-14040, CVE-2018-14041,
  CVE-2018-14042, and CVE-2019-8331
