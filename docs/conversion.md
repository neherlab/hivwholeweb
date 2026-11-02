# Conversion from the Flask server to a static site

Until 2026, a Flask application served `https://hiv.biozentrum.unibas.ch`: Python 2.7, uWSGI, and nginx in Docker on a university VM. The static site replaces it at `https://hiv.neherlab.org`, built from `src/`, so that no server code runs and no server needs security updates. Users get the same pages and data, except for the changes listed below.

The conversion copies the old site and changes only what a static host cannot do. Every file that users receive is one of these:

- a page or static file captured from the live server
- a reviewed edit of a captured file
- data that the old server computed, recomputed with the code of the old server
- a data file of the old server, copied unchanged

The git tag `server-app-last-deployed-version` holds the code of the old server; its last change before the conversion is commit `92f6e82`. The capture of the live server and the conversion tools are not kept: this repository holds only what the static site needs, and this document records the sources of the conversion and the results of its checks.

## Sources

- **Capture of the live server**: 2026-10-28, every page, static file, and API URL of the old server, with the status, content type, size, and sha256 of each live response
- **Old server code**: `app/` at the tag `server-app-last-deployed-version`
- **Data directory**: the private bucket `s3://hivwholeweb-data` (9.4 GiB), which the analysis pipeline of the `hivwholeseq` repository exported. The conversion reads it and does not change it
- **ETI science code**: the repository `HIV_time_of_infection` on the GitLab of sciCORE, branch `website`, commit `3b2f5a5`, the submodule `app/hiv/HIV_time_of_infection` of the old server

## Server features and their static form

- **Pages** (`/`, `/patient/p1/`, `/region/V3/`, ...): HTML files in `src/`
- **Static files** (`/static/...`, `/method/static/...`): files in `src/`
- **API** (`/api/data/...`): JSON objects on the data host, from `web-data/api/`
- **Data files** (`/static/data/<file>`): objects on the data host, copied from the private bucket
- **Download aliases** (`/download/<alias>`): the pages link the file instead. For example, `/download/haplotypes_p6_PR.fasta` became `/static/data/alignments/haplotype_alignment_p6_PR.fasta`
- **Download forms**: the old server answered a POST with a redirect to the file. `src/static/js/download_forms.js` builds the file path in the browser
- **Time-since-infection estimator** (ETI, a POST to `/ETI/`): `src/static/eti/estimator.js` computes the estimate in the browser (`src/static/eti/README.md`)
- **Custom haplotype alignments** for a chosen region: removed, because they need a server to compute alignments. The precompiled alignments stay

## Changes for users

- The custom haplotype panels are removed.
- The precompiled haplotype forms offer the regions that have alignments. The old forms named five regions without alignments and left out eight that have them.
- The data page links only the pair count (`cocounts`) files that the data directory holds; the others were never computed.
- The data page has no "Time of infection" column. The old server never filled its links, and the data holds no such table.
- The p4 page has no example tree image, because the analysis pipeline made none for this patient.
- The tutorial (`/tutorial/`) and reveal.js are removed. The tutorial was an unfinished draft that no page linked to, and it did not start on the old server, because reveal.js lacked its `lib/` files.
- The ETI estimator works. The old ETI form answered HTTP 500 for every valid input, because the server looked for the training data relative to the wrong working directory.
- The region slider of the haplotypes method page (`/method/haplotypes/`) draws. It loads the HXB2 reference from the API, as the data page does; the old page posted to `/method/genomes/`, which answered 405.
- The tree page (`/method/trees/`) offers only the consensus regions for patient "all", because haplotype trees (regions `<region>_minor`) exist only for single patients. The old page drew nothing for "all" with such a region.
- The "Download tree" link of the tree page names the tree that the page shows. The old link of a haplotype tree named the consensus tree of the region.
- The links to the patient and region pages end with a slash (`/patient/p1/`). The old server redirected the links without the slash; a static host answers them with 404.
- jQuery and Bootstrap are upgraded to versions without known XSS advisories (`src/static/components/VERSIONS.md`).
- `robots.txt` keeps crawlers off the data paths, and the data host disallows all crawling.

## Derived data and its checks

The conversion computed each of these once. Each check failed on any difference from its reference:

- **`src/`**: the capture plus reviewed edits. Each edit was an exact replacement with an expected number of matches, so an edit failed instead of changing the wrong text, and a check applied the edits to the capture again and required the result to equal the pages. Later changes are ordinary commits to `src/`
- **`web-data/api/`**: the old Flask app ran in its Python 2.7 image over the data directory and wrote the response of every API URL of the capture. All 725 responses equal the live responses byte for byte (the sha256 values of the capture)
- **`web-data/static/eti/data/`**: the training data of the ETI estimator, computed with numpy from the frequency data of the ETI repository
- **`tests/golden/eti/`**: result pages of the old Flask app for a grid of inputs and for edge cases of the form parsing. Because the live ETI form failed, the reference is the old app in its image, not the live server. `tests/test_gm_eti.ts` compares the estimator with these pages in `just test-eti`. A comparison over about 10000 more inputs found equal page texts and histogram counts, and plotted numbers equal bit for bit except in windows over the whole genome, where they differ by at most 4 ULP (`src/static/eti/README.md`)
- **`data-manifest.json`**: `web-data/` plus the files of the data directory that the pages link to, and two zip archives of them (`just data-manifest`). The data host holds only these files, so it makes public exactly the files that the old server linked
