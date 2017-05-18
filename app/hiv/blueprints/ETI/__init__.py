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
    from ..method.forms import ETIForm, ETIFileForm
    from ...models import ETIModel
    form = ETIForm()
    #form_file = ETIFileForm()

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
                res = hm.estimate()
                cont = True
            except ValueError:
                flash('An error occurred during the estimation')
                cont = False
                res = None

            if cont:
                return render_template(
                  'ETI_result.html',
                   form=form,
                   region='RT',
                   params = {'xc':xc, 'start':start+1, 'end':end, 'diversity':diversity},
                   ETI=res["ETI"][0],
                   result = [{'data':res['training_data'], 'label':'training'},
                             {'data':[[res['ETI'][0], diversity]], 'label':"estimate"}],
                   stats = res['stats'],
                   title='Time since Infection estimate',
                  )


    return render_template('ETI.html',
                           form=form,
                           region='RT',
                           title='Time since Infection',
                          )


# Blueprint
ETI_result = Blueprint('ETI_result', __name__,
                 url_prefix='/ETI_result',
                 static_folder='static',
                 template_folder='templates')

