# ETI estimator

`estimator.js` estimates the time since infection (ETI) from the diversity of a
genome region, as the ETI page of the old server did. It is a JavaScript port of
the science code of the repository `ssh://git@git.scicore.unibas.ch:2222/neherlab/HIV_time_of_infection.git`,
branch `website`, commit `3b2f5a5258c5af81950f28307fd5458674766452` (MIT license,
`LICENSE`), which the old server included as the submodule
`app/hiv/HIV_time_of_infection`. The git tag `server-app-last-deployed-version`
of this repository holds the code of the old server; its last change before the
conversion is commit `92f6e82`. The capture of the live server and the
conversion tools are not kept.

The estimate fits a line, time against diversity, through the training samples
of 11 patients (Puller, Neher, and Albert,
[doi:10.1101/129387](https://doi.org/10.1101/129387)). For each sample, the
diversity is the mean over the chosen region of the per-site diversity `1 -
sum(f^2)`, where sites whose largest allele frequency is above `1 - cutoff`
count as 0. The fit depends on the region, the codon position, and the cutoff,
so the page computes it for every input; it takes a few milliseconds.

## Training data

During the conversion, a numpy script computed the per-site values that the
estimate reads from the frequency data of the submodule (`Frequency_Data/`,
31 MB) and wrote them to `web-data/static/eti/data/training-<hash>.bin` (1.5 MB),
which the data host serves. Most covered sites have one allele and a diversity
of exactly 0, so the file stores values only for the other sites.
`manifest.json` names the file and holds its subresource integrity hash, which
the page checks.

## Results

The estimate repeats the arithmetic of numpy 2 operation by operation: the
pairwise summation of `np.sum`, `np.round`, `np.percentile`, and `np.histogram`.
It parses and formats numbers as Python 2 did. Two checks compare it with the
old Flask app (`app/` at the tag, in its Python 2.7 image):

- `tests/test_gm_eti.ts`, in `just test-eti`: the golden master
  `tests/golden/eti/`, result pages of the old app, captured during the
  conversion
- a comparison during the conversion: a grid of about 10000 inputs over every
  gene, windows of 1 to 3000 sites along the genome, the codon positions, and a
  range of cutoffs

The page texts and histogram counts match exactly. The plotted numbers match
bit for bit, except in windows over the whole genome: there numpy 1.12 of the
old server summed the sites in another order, and the numbers differ in their
last bits.

The old server answered some inputs with HTTP 500: a missing or non-numeric
cutoff, a region with fewer than two training samples, and training samples
that all have the same diversity (for example a cutoff of 0.5 or more). The
estimator shows the estimation error message for them.
