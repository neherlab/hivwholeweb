// Download forms: build the URL of the data file from the form's fields and open it.
// A form names its URL in data-download, with {field} for each select, such as
// data-download="/static/data/alignments/haplotype_alignment_{patient}_{region}.fasta".
document.addEventListener("submit", function (event) {
  var form = event.target;
  var template = form.getAttribute("data-download");
  if (template === null) {
    return;
  }
  event.preventDefault();
  window.location.assign(
    template.replace(/\{(\w+)\}/g, function (match, name) {
      return encodeURIComponent(form.elements[name].value);
    }),
  );
});
