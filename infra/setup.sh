# Add user `neherlab` to groups `www-data`, `docker`
sudo usermod -aG www-data neherlab
sudo usermod -aG docker neherlab

# Restart cron service
sudo systemctl restart cron.service

# Copy systemd service and timer files
sudo cp hivwholeweb.{service,timer} /etc/systemd/system/

# Reload service files
sudo systemctl daemon-reload

# Enable and start service
sudo systemctl enable hivwholeweb.service
sudo systemctl start hivwholeweb.service
