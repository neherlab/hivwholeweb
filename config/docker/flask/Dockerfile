# We freeze the image to this particular hash which points to python:2.7.18-buster
# https://hub.docker.com/layers/python/library/python/2.7.18-buster/images/sha256-c934af72b8bd03b9804d5bde2569c320926e70392d708d113a2e71bcf98c8a20?context=explore
FROM python@sha256:c934af72b8bd03b9804d5bde2569c320926e70392d708d113a2e71bcf98c8a20

ARG UID
ARG GID
ARG USER
ARG GROUP

ENV UID=${UID}
ENV GID=${GID}
ENV USER=${USER}
ENV GROUP=${GROUP}

RUN set -x \
  && export DEBIAN_FRONTEND=noninteractive \
  && apt-get update -qq --yes \
  && apt-get install -qq --no-install-recommends --yes \
  uwsgi \
  uwsgi-plugin-python \
  >/dev/null \
  && apt-get autoremove --yes >/dev/null \
  && apt-get clean autoclean >/dev/null

RUN unset -v PYTHONPATH

RUN set -x \
  && cd /usr/lib/python2.7 \
  && ln -s plat-x86_64-linux-gnu/_sysconfigdata_nd.py .

COPY config/docker/flask/files /

COPY app /app/app

RUN set -x \
  && pip install --upgrade numpy==1.12.0 \
  && pip install --upgrade -r app/app/requirements.txt -t /app/app

USER $UID:$GID

ENTRYPOINT ["/entrypoint.sh"]
