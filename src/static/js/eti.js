// ETI page: computes the estimate in the browser (src/static/eti/estimator.js)
// and shows the result panel that the old server rendered after a POST of the form.
import { estimate, parseTraining } from "/static/eti/estimator.js";

// The training data lives on the data host: the build (scripts/build.ts) points this prefix to it.
const DATA_BASE = "/static/eti/data/";

const form = document.getElementById("etiForm");
const button = form.querySelector('button[type="submit"]');
const label = button.textContent;
const alertBox = document.getElementById("etiError");
const alertText = document.getElementById("etiErrorText");
const resultPanel = document.getElementById("etiResult");

setBusy("Loading...");

loadTraining().then(
  (training) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      alertBox.hidden = true;
      const output = estimate(training, {
        diversity: form.elements.diversity.value,
        xc: form.elements.xc.value,
        start: form.elements.start.value,
        end: form.elements.end.value,
        codon_pos: form.elements.codon_pos.value,
      });
      if (output.message === undefined) {
        showResult(output);
      } else {
        // As the old page after a rejected input: the message and the form, no result.
        resultPanel.hidden = true;
        showError(output.message);
      }
    });
    setIdle();
  },
  (error) => {
    showError(`The estimator could not load: ${error.message}`);
    button.textContent = label;
  },
);

async function loadTraining() {
  const manifest = await fetchChecked("/static/eti/manifest.json", {});
  const { file, integrity } = (await manifest.json()).training;
  const response = await fetchChecked(DATA_BASE + file, { integrity });
  return parseTraining(await response.arrayBuffer());
}

async function fetchChecked(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return response;
}

function showResult(value) {
  Object.entries(value.display).forEach(([name, text]) => {
    document.getElementById(`eti-${name}`).textContent = text;
  });
  resultPanel.hidden = false;
  emptyDivs("ETI_training_div");
  emptyDivs("ETI_distribution_div");
  drawETI_diversity("ETI_training_div", value.result);
  drawETI_distribution("ETI_distribution_div", value.hist);
}

function showError(text) {
  alertText.textContent = text;
  alertBox.hidden = false;
}

function setBusy(text) {
  button.disabled = true;
  button.textContent = text;
}

function setIdle() {
  button.disabled = false;
  button.textContent = label;
}
