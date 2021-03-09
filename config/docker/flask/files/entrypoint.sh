#!/usr/bin/env bash

BASH_DEBUG="${BASH_DEBUG:=}"
([ "${BASH_DEBUG}" == "true" ] || [ "${BASH_DEBUG}" == "1" ]) && set -o xtrace
set -o errexit
set -o nounset
set -o pipefail
shopt -s dotglob
trap "exit" INT

export PYTHONPATH=${PYTHONPATH:-}:/usr/local/lib/python2.7
export PYTHONPATH=${PYTHONPATH:-}:/usr/local/lib/python2.7/site-packages
export PYTHONPATH=${PYTHONPATH:-}:/usr/local/lib/python2.7/lib-dynload
export PYTHONPATH=${PYTHONPATH:-}:/usr/lib/python2.7
export PYTHONPATH=${PYTHONPATH:-}:/usr/lib/python2.7/site-packages
export PYTHONPATH=${PYTHONPATH:-}:/usr/lib/python2.7/lib-dynload

pushd /app/app >/dev/null
uwsgi --ini /etc/uwsgi/uwsgi.ini --master
popd >/dev/null
