# vim: fdm=indent
'''
author:     Richard Neher
date:       11/05/2017
content:    Blueprint for the date of infection page.
'''
# Modules
from flask import (Blueprint, render_template, abort, flash,
                   redirect, request, jsonify, make_response)



# Blueprint
ETI = Blueprint('ETI', __name__,
                 url_prefix='/ETI',
                 static_folder='static',
                 template_folder='templates')



# Views
@ETI.route('/', methods=['GET', 'POST'])
def index():
    # Haplotype forms
    from ..method.forms import ETIForm
    from ...models import LocalHaplotypeModel
    form = ETIForm()

    if request.method == 'POST':
        if (not form.validate_on_submit()):
            flash('Diversity form incorrectly filled!')

        elif form.validate_on_submit():
            # NOTE: we offer only genomewide HXB2 coordinates
            region = 'genomewide'
            pname = form.patient.data
            start = form.roi.start.data - 1 #Inclusive coordinates
            end = form.roi.end.data
            roi = (region, start, end)

            hm = LocalHaplotypeModel(pname, roi)
            try:
                hm.translate_coordinates()
                cont = True
            except ValueError:
                flash('No PCR fragment covers such region, please select another region')
                cont = False

            if cont:
                # Get the data from a temporary folder + file
                # NOTE: the temp folders are cleaned regularly at a timeout specified
                # in the config file, so no need to to that here.
                fn = hm.get_data()

                # TODO: refine this to show a success page with a download link etc. (that
                # changes the policies on temporary files, storage use, etc., so watch out)
                with open(fn, 'r') as f:
                    fstr = f.read()
                response = make_response(fstr)
                response.headers["Content-Disposition"] = ("attachment; filename="+
                                                           "haplotypes_"+pname+
                                                           "_"+str(start+1)+
                                                           "_"+str(end)+
                                                           ".fasta")
                return response

    return render_template('ETI.html',
                           form=form,
                           fragments=['F'+str(i) for i in xrange(1, 7)],
                           title='Downloads',
                          )
