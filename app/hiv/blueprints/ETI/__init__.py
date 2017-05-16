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
                hm.print_input()
                res = hm.estimate()
                cont = True
            except ValueError:
                flash('Not quite there yet')
                cont = False
                res = None

            if cont:
                return render_template('ETI_result.html',
                               form=form,
                               region='RT',
                               params = {'xc':xc, 'start':start+1, 'end':end, 'diversity':diversity},
                               ETI=res["ETI"][0],
                               result = [{'data':res['training_data'], 'label':'training'},
                                         {'data':[[res['ETI'][0], diversity]], 'label':"estimate"}],
                               stats = res['stats'],
                               title='Time since Infection result',
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

# Views
@ETI_result.route('/', methods=['GET', 'POST'])
def index():
    # Haplotype forms
    from ..method.forms import ETIForm, ETIFileForm
    from ...models import ETIModel
    form = ETIForm()
    form_file = ETIFileForm()

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
                cont = True
            except ValueError:
                flash('Not quite there yet')
                cont = False

            if cont:
                return render_template('ETI_result.html',
                               form=form,
                               region='RT',
                               result = [{'data':[[100, 0.04], [500, .05]], 'patient':'p1'},
                                        {'ds':[[200, 0.01], [900, 0.07]], 'patient':'p2'}],
                               title='Time since Infection result',
                              )


    return render_template('ETI_result.html',
                           form=form,
                           region='RT',
                           result = [{'ds':[[100, 0.01], [500, .05]], 'patient':'p1'},
                                    {'ds':[[200, 0.01], [900, 0.07]], 'patient':'p2'}],
                           title='Time since Infection result',
                          )
