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
./scripts/install_docker.sh
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

#### Recommended: running the application in background

To launch the application using docker-compose *as a detached process* type:

```
./scripts/run.sh
```

It is safe to close the terminal session and then come back - the pplication will keep running.
In case of container failure or machine restart, the affected containers will restart automatically.

To browse logs:

```
./scripts/logs.sh
```

To shutdown the application:

```
./scripts/stop.sh
```


#### Alternative: running the application while browsing logs (attached)

To launch the application using docker-compose with the script:

```
./scripts/run-attached.sh
```

The logs can be seen immediately. To shutdown the application press Ctrl+C. The application will be terminated if the terminal session is closed.

One could use GNU Screen to make application in this mode persist across terminal sessions:

```
screen -qxRS app -- ./scripts/run-attached.sh
```


#### Implementation details:

The flask/uwsgi application is running inside `hivwholeweb-flask` container based on Python 2.7 Debian image (`config/docker/flask/Dockerfile`). The `hivwholeweb-nginx` container (`config/docker/flask/Dockerfile`) serves the application. The 2 containers are orchestrated using docker-compose (`config/docker/docker-compose.yml`).
