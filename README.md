## HIVWHOLEWEB
Web application for deep sequencing on longitudinal HIV-1 samples from patients.

![screenshot](screenshot.png)


### Running using docker and docker-compose

#### Requirements:

 - Linux (tested on Ubuntu 20.04)
 - bash
 - docker
 - docker-compose

On Ubuntu 20.04 you can use convenience script:

```
./install_docker.sh
```

#### Data

Assuming the project's code is located in `hivwholeweb`, put the data into `hivwholeweb_data` like so:

```
├──hivwholeweb
│   ├── LICENSE
│   ├── README.md
│   ├── app
│   ├── config
│   ├── html
│   ├── requirements.txt
│   ├── run.sh
│   ├── screenshot.png
│   └── wsgi
└── hivwholeweb_data
    ├── alignments
    ├── cell_data
    ├── cell_trees
    ├── coordinate_maps
    ├── coverage
    ├── divdiv
    ├── hla
    ├── insertions
    ├── pair_aminoacid_variants
    ├── pair_nucleotide_variants
    ├── physiological
    ├── reads
    ├── sequences
    ├── single_aminoacid_variants
    ├── single_nucleotide_variants
    ├── tables
    ├── time_points
    ├── trees
    └── xsectional
```

#### Running the application

Run docker-compose using the convenience script:

```
./run.sh
```

#### Implementation details:

The flask/uwsgi application is running inside `hivwholeweb-flask` container based on Python 2.7 Debian image (`config/docker/flask/Dockerfile`). The `hivwholeweb-nginx` container (`config/docker/flask/Dockerfile`) serves the application. The 2 containers are orchestrated using docker-compose (`config/docker/docker-compose.yml`).
