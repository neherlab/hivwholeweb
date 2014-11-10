from flask import render_template, flash, redirect, request, jsonify
from . import hiv
from .forms import PatFragForm, PatForm
from .models import (TreeModel, PhysioModel, DivdivModel, CoverageModel,
                     GenomeModel, AlleleFrequencyModel, SFSModel,
                     PropagatorModel, DivdivLocalModel)
from .backbone import find_section


@hiv.route('/')
@hiv.route('/index/')
def index():
    return render_template('index.html',
                           title='Home',
                           section_name='Home',
                          )


@hiv.route('/trees/', methods=['GET', 'POST'])
def trees():
    if request.json:
        req = request.json
        tree = TreeModel(req['patient'], req['fragment']).get_newick_string()
        data = {'newick': tree}
        return jsonify(**data)

    form = PatFragForm()
    if request.method == 'GET':
        show_intro = True
        pnames = ['all']
        fragments = ['F1']
    else:
        show_intro = False
        pnames = ['p'+str(i+1) for i in xrange(11)
                  if getattr(form, 'p'+str(i+1)).data]
        fragments = ['F'+str(i+1) for i in xrange(6)
                     if getattr(form, 'F'+str(i+1)).data]
        if not form.validate_on_submit():
            flash('Select at least one fragment and patient!')

    dicts = []
    for pname in pnames:
        for fragment in fragments:
            dicts.append({'pname': pname,
                          'fragment': fragment,
                          'name': pname+', '+fragment,
                          'id': pname+'_'+fragment})

    return render_template('trees.html',
                           title='Phylogenetic trees',
                           dicts=dicts,
                           form=form,
                           show_intro=show_intro,
                           section_name='Phylogenetic trees',
                          )


@hiv.route('/physiological/', methods=['GET', 'POST'])
def physio():
    if request.json:
        pname = request.json['patient']
        data = {'data': PhysioModel(pname).get_data()}
        return jsonify(**data)

    form = PatForm()
    if request.method == 'GET':
        show_intro = True
        pnames = ['p1']
    else:
        show_intro = False
        pnames = ['p'+str(i+1) for i in xrange(11)
                  if getattr(form, 'p'+str(i+1)).data]
        if not form.validate_on_submit():
            flash('Select at least one patient!')

    dicts = []
    for pname in pnames:
        dicts.append({'pname': pname,
                      'name': pname,
                      'id': pname})

    return render_template('physio.html',
                           title='Viral load and CD4+ counts',
                           dicts=dicts,
                           form=form,
                           show_intro=show_intro,
                           section_name='Viral load and CD4+ counts',
                          )


@hiv.route('/divdiv/', methods=['GET', 'POST'])
def divdiv():
    if request.json:
        req = request.json
        pname = request.json['patient']
        fragment = request.json['fragment']
        data = {'data': DivdivModel(pname, fragment).get_data()}
        return jsonify(**data)

    form = PatFragForm()
    if request.method == 'GET':
        show_intro = True
        pnames = ['p1']
        fragments = ['F1']
    else:
        show_intro = False
        pnames = ['p'+str(i+1) for i in xrange(11)
                  if getattr(form, 'p'+str(i+1)).data]
        fragments = ['F'+str(i+1) for i in xrange(6)
                     if getattr(form, 'F'+str(i+1)).data]
        if not form.validate_on_submit():
            flash('Select at least one fragment and patient!')

    dicts = []
    for pname in pnames:
        for fragment in fragments:
            dicts.append({'pname': pname,
                          'fragment': fragment,
                          'name': pname+', '+fragment,
                          'id': pname+'_'+fragment})

    return render_template('divdiv.html',
                           title='Divergence and diversity',
                           dicts=dicts,
                           form=form,
                           show_intro=show_intro,
                           section_name='Divergence and diversity',
                          )

@hiv.route(find_section(id='genome')['url'], methods=['GET', 'POST'])
def genomes():
    if request.json:
        pname = request.json['patient']
        data = {'data': GenomeModel(pname).get_data()}
        return jsonify(**data)

    section = find_section(id='genome')

    form = PatForm()
    if request.method == 'GET':
        show_intro = True
        pnames = ['p1']
    else:
        show_intro = False
        pnames = ['p'+str(i+1) for i in xrange(11)
                  if getattr(form, 'p'+str(i+1)).data]
        if not form.validate_on_submit():
            flash('Select at least one patient!')

    dicts = []
    for pname in pnames:
        dicts.append({'pname': pname,
                      'name': pname,
                      'id': pname})

    return render_template('genome.html',
                           title=section['name'],
                           dicts=dicts,
                           form=form,
                           show_intro=show_intro,
                           section_name=section['name'],
                          )


@hiv.route('/coverage/', methods=['GET', 'POST'])
def coverage():
    if request.json:
        pname = request.json['patient']
        data = {'data': CoverageModel(pname).get_data()}
        return jsonify(**data)

    form = PatForm()
    if request.method == 'GET':
        show_intro = True
        pnames = ['p1']
    else:
        show_intro = False
        pnames = ['p'+str(i+1) for i in xrange(11)
                  if getattr(form, 'p'+str(i+1)).data]
        if not form.validate_on_submit():
            flash('Select at least one patient!')

    dicts = []
    for pname in pnames:
        dicts.append({'pname': pname,
                      'name': pname,
                      'id': pname})

    return render_template('coverage.html',
                           title='Coverage',
                           dicts=dicts,
                           form=form,
                           show_intro=show_intro,
                           section_name='Coverage',
                          )


@hiv.route(find_section(id='divdiv_local')['url'], methods=['GET', 'POST'])
def divdiv_local():
    if request.json:
        pname = request.json['patient']
        data = {'data': DivdivLocalModel(pname).get_data()}
        return jsonify(**data)

    section = find_section(id='divdiv_local')

    form = PatForm()
    if request.method == 'GET':
        show_intro = True
        pnames = ['p1']
    else:
        show_intro = False
        pnames = ['p'+str(i+1) for i in xrange(11)
                  if getattr(form, 'p'+str(i+1)).data]
        if not form.validate_on_submit():
            flash('Select at least one patient!')

    dicts = []
    for pname in pnames:
        dicts.append({'pname': pname,
                      'name': pname,
                      'id': pname})

    return render_template('divdiv_local.html',
                           title=section['name'],
                           dicts=dicts,
                           form=form,
                           show_intro=show_intro,
                           section_name=section['name'],
                          )


@hiv.route(find_section(id='af')['url'], methods=['GET', 'POST'])
def allele_frequencies():
    if request.json:
        pname = request.json['patient']
        data = {'data': AlleleFrequencyModel(pname).get_data()}
        return jsonify(**data)

    section = find_section(id='af')

    form = PatForm()
    if request.method == 'GET':
        show_intro = True
        pnames = ['p1']
    else:
        show_intro = False
        pnames = ['p'+str(i+1) for i in xrange(11)
                  if getattr(form, 'p'+str(i+1)).data]
        if not form.validate_on_submit():
            flash('Select at least one patient!')

    dicts = []
    for pname in pnames:
        dicts.append({'pname': pname,
                      'name': pname,
                      'id': pname})

    return render_template('allele_frequencies.html',
                           title=section['name'],
                           dicts=dicts,
                           form=form,
                           show_intro=show_intro,
                           section_name=section['name'],
                          )


@hiv.route(find_section(id='sfs')['url'], methods=['GET', 'POST'])
def sfs():
    if request.json:
        data = {'data': SFSModel().get_data()}
        return jsonify(**data)

    section = find_section(id='sfs')

    # NOTE: we probably want to support several plots here
    show_intro = True

    return render_template('sfs.html',
                           title=section['name'],
                           show_intro=show_intro,
                           section_name=section['name'],
                          )


@hiv.route(find_section(id='prop')['url'], methods=['GET', 'POST'])
def propagators():
    if request.json:
        data = {'data': PropagatorModel().get_data()}
        return jsonify(**data)

    section = find_section(id='prop')

    # NOTE: we might want to support several plots here
    show_intro = True

    return render_template('propagator.html',
                           title=section['name'],
                           show_intro=show_intro,
                           section_name=section['name'],
                          )

