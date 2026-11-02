# Vendored libraries

The pages load these files from the official releases. jQuery and Bootstrap
replace the versions that the old server shipped (jQuery 2.1.1, Bootstrap
3.3.1), because those have published XSS advisories.

- jQuery 3.7.1 from https://code.jquery.com/ (`jquery/dist/`), which fixes
  CVE-2015-9251, CVE-2019-11358, CVE-2020-11022, and CVE-2020-11023
  - `jquery.min.js` sha256 `fc9a93dd241f6b045cbff0481cf4e1901becd0e12fb45166a8f17f95823f0b1a`
  - `jquery.js` sha256 `78a85aca2f0b110c29e0d2b137e09f0a1fb7a8e554b499f740d6744dc8962cfe`
- Bootstrap 3.4.1 from https://github.com/twbs/bootstrap/releases/tag/v3.4.1
  (`bootstrap-3.4.1-dist.zip`, sha256 `d49793cf773cbd393ac2cf340c3b4ddab5365fa7c292098ac07e12eab3efd92e`,
  unpacked to `bootstrap/dist/`), which fixes CVE-2018-14040, CVE-2018-14041,
  CVE-2018-14042, and CVE-2019-8331
- d3 3.4.13, minified, from the npm package `d3@3.4.13`
  (https://registry.npmjs.org/d3/-/d3-3.4.13.tgz, sha512 `JtOiQwlpzhbQEgc6CKs/mL2XsxIzKpWwKcWTfIsLVlWNGN8OTyiKTNeWvJdW7bYj6sb/+n9Ia78KP2yuM7g+4g==`),
  whose `d3.js` equals the vendored `d3/d3.js` byte for byte
  - `d3.min.js` sha256 `f717263df71b14fb151931ad0a9695738fb98124a76bb723e1b9cfb9152b7a3e`
