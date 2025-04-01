# HIVWHOLEWEB (legacy)

https://hiv.biozentrum.unibas.ch

Web application for deep sequencing on longitudinal HIV-1 samples from patients.

![screenshot](screenshot.png)


## Running using docker and docker-compose

### Requirements

 - bash
 - docker
 - docker-compose

### Running

To launch the application using docker-compose with the script:

```
./scripts/run-attached.sh
```

To shut down the application press Ctrl+C. Wait for the build to finish and navigate to `http://localhost:80`


### Implementation details

The app is deployed on a VM at

```
bz-rgrn01-vsl01.bioz.unibas.ch
```

which is assigned a user-facing domain name:
```
hiv.biozentrum.unibas.ch
```

 - The flask/uwsgi application is running inside `hivwholeweb-flask` container based on Python 2.7 Debian image (`config/docker/flask/Dockerfile`). 
 - The `hivwholeweb-nginx` container (`config/docker/flask/Dockerfile`) serves the application.
 - The 2 containers are orchestrated using docker-compose (`config/docker/docker-compose.yml`).
 - The helper scripts in the `scripts/` directory allow to start and stop the app.
 - The systemd `hivwholeweb.service` in the `infra/` directory allows to (re)start and stop the app system-wide.
 - The VMs are assumed to have TSL certs installed (typically in `/etc/ssl/`) and updated periodically
 - On cert update, the external updated restarts the `hivwholeweb` systemd service

### Deployment

1. Request a virtual machine (VM) from unibas IT folks and give them **public** key(s) to add so that you can SSH to the machine.

2. SSH to the VM. Currently, you need to ssh as a `neherlab` user to the `bz-rgrn01-vsl01.bioz.unibas.ch`:

    For the current deployment, get the **private** SSH key `neherlab-dev-unibas-vms-2025-02-20_12-54-56_229Z` from 1Password and follow instructions in the note attached to the 1Password entry, but basically download the kay and do this:
    ```bash
    ssh -i ~/.ssh/neherlab-dev-unibas-vms-2025-02-20_12-54-56_229Z neherlab@bz-rgrn01-vsl01.bioz.unibas.ch
    ```

3. Clone the repo. Currently, the path `/home/neherlab/hivwholeweb` is assumed in a few places, so make sure to find-and-replace it if you are going to go adventurous and decide to change the path. The data is on S3 in `s3://hivwholeweb-data`. Assuming the project's code is located in `hivwholeweb`, put the data into sibling directory `hivwholeweb_data`. You probably want to get it to your local machine first and then rsync it to the VM, to avoid dealing with AWS credentials on the VM.

4. Make sure to modify `docker-compose.yml` and/or `nginx.conf` to point to the correct path of TLS certs which IT folks have installed to the host machine. Ask them for the paths. The current paths are:

    ```bash
    /etc/ssl/bz-rgrn01-vsl01.bioz.unibas.ch.fullchain.pem
    /etc/ssl/bz-rgrn01-vsl01.bioz.unibas.ch.privkey.pem
    ```

    These certs will be automatically updated periodically and the updater, on their side, will restart the app using our systemd service.

5. Try to launch the app manually:

    ```bash
    ./scripts/run-attached.sh
    ```

    Wait for the app to build. Try to reach `localhost` in another SSH instance:

    ```bash
    curl -fksSLvv https://localhost
    ```
    
    If all goes well you should see some HTML.
    
    Check the TLS cert being served:

    ```bash
    echo | openssl s_client -connect localhost:443 -servername hiv.biozentrum.unibas.ch -showcerts | openssl x509 -noout -text
    ```

    Try to reach the app from outside, on the internet, by its "ugly" hostname or by IP address. Currently, that would be
   
    ```bash
    curl -fksSLvv https://bz-rgrn01-vsl01.bioz.unibas.ch
   
    echo | openssl s_client -connect bz-rgrn01-vsl01.bioz.unibas.ch:443 -servername hiv.biozentrum.unibas.ch -showcerts | openssl x509 -noout -text
    ```

    You should also be able to open the app in a web browser now.

    Now that the manual verification succeeded, stop the `run-attached.sh` script using Ctrl+C and wait for it to stop.

6. SSH to the machine as root or as a `sudo`-capable user (ask IT folks to set it up for you). Install systemd service and start it using the steps in the `./infra/setup.sh`. The systemd service should build and start the app just like you did it above (using `run-attached.sh`). Give it a few minutes.

   Check the status and logs of the systemd unit:

   ```bash
   sudo systemctl --no-pager status hivwholeweb
   sudo journalctl --no-pager -u hivwholeweb
   ```

   Follow the logs in real time with:
   ```bash
   sudo journalctl --no-pager -f -u hivwholeweb
   ```

   Repeat verification steps from above (obviously don't run `run-attached.sh` this time).

   If that also succeeds, then ask IT folks to switch the DNS records of the `hiv.biozentrum.unibas.ch` to this machine. Once done, verify that the domain resolves to the same IP address as the new machine (not the old machine):

   ```bash
   # Replies with the external IP of the machine
   curl -s https://checkip.amazonaws.com
   
   # Resolves domain name
   dig +short hiv.biozentrum.unibas.ch
   ```

   The run the verification above again, but now with this domain name. Make sure that you see access log entries when you are hitting the app with requests from outside (so that we know that we are talking to the new machine, and not the old one).





