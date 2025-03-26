FROM nginx:1.19.7

ARG UID
ARG GID
ARG USER
ARG GROUP

ENV UID=${UID}
ENV GID=${GID}
ENV USER=${USER}
ENV GROUP=${GROUP}

RUN set -x \
&&  if ! getent group "${GROUP}"; \
    then \
      addgroup --gid "${GID}" "${GROUP}"; \
    fi \
&&  if ! getent passwd "${USER}"; \
    then \
      adduser --system --uid "${UID}" --ingroup "${GROUP}" --groups "www-data" --home "/home/${USER}" --shell /bin/bash "${USER}"; \
    else \
      adduser "${USER}" "www-data" || true; \
    fi

RUN set -x \
  && mkdir -p /home/$USER \
  && mkdir -p /web \
  && mkdir -p /sourcemaps \
  && mkdir -p /var/lib/nginx/logs \
  && mkdir -p /var/cache/nginx \
  && touch /var/lib/nginx/logs/access.log \
  && touch /var/lib/nginx/logs/error.log \
  && ln -sf /dev/stdout /var/lib/nginx/logs/access.log \
  && ln -sf /dev/stderr /var/lib/nginx/logs/error.log \
  && chown $UID:$GID -R /home/$USER \
  && chown $UID:$GID -R /var/lib/nginx \
  && chown $UID:$GID -R /var/cache/nginx \
  && chown $UID:$GID -R /web \
  && chown $UID:$GID -R /sourcemaps

COPY config/docker/nginx/files /

USER $USER

ENTRYPOINT ["nginx", "-g", "daemon off;"]
