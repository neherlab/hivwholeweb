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
    from ...models import ETIModel
    form = ETIForm()

    if request.method == 'POST':
        if (not form.validate_on_submit()):
            flash('Diversity form incorrectly filled!')

        elif form.validate_on_submit():
            # NOTE: we offer only genomewide HXB2 coordinates
            diversity = form.diversity.data
            xc = form.xc.data
            start = form.start.data - 1 #Inclusive coordinates
            end = form.end.data
            roi = (start, end)

            hm = ETIModel(diversity, xc, roi)
            try:
                hm.print_input()
                cont = False
            except ValueError:
                flash('Not quite there yet')
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
                           title='Time since Infection',
                          )
