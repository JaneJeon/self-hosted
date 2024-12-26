server init requirements:

- create non-root sudo user https://www.digitalocean.com/community/tutorials/initial-server-setup-with-ubuntu-20-04
- basic ufw config https://www.digitalocean.com/community/tutorials/how-to-set-up-a-firewall-with-ufw-on-ubuntu-20-04 https://wiki.archlinux.org/title/Uncomplicated_Firewall
- disable password auth https://www.digitalocean.com/community/tutorials/how-to-set-up-ssh-keys-on-debian-11
- unattended-upgrades https://haydenjames.io/how-to-enable-unattended-upgrades-on-ubuntu-debian/
- install docker & compose https://docs.docker.com/compose/install/

```sh
# (computer) SSH into box as root
# (server):

adduser jane # interactive prompts
usermod -aG sudo jane # make myself sudo-er

sudo update-alternatives --config editor # (enter /usr/bin/vim.basic prompt)
sudo visudo # interactive prompt: add "jane ALL=(ALL:ALL) NOPASSWD: ALL" to the bottom of the file

sudo ln -sf /usr/share/zoneinfo/America/New_York /etc/localtime

sudo apt update && sudo apt upgrade && sudo apt install rsync make
mkdir self-hosted

sudo apt install unattended-upgrades

sudo vim /etc/apt/apt.conf.d/50unattended-upgrades
# enable the following:
#
# Unattended-Upgrade::Origins-Pattern {
# origin=Debian,codename=${distro_codename}-updates;
# origin=Debian,codename=${distro_codename},label=Debian;
# origin=Debian,codename=${distro_codename},label=Debian-Security;
# origin=Debian,codename=${distro_codename}-security,label=Debian-Security;
# }
# Unattended-Upgrade::Mail "asdf@example.com";
# Unattended-Upgrade::MailReport "on-change";
# Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
# Unattended-Upgrade::Remove-New-Unused-Dependencies "true";
# Unattended-Upgrade::Remove-Unused-Dependencies "true";

# (computer):
ssh-copy-id jane@remote_host # (enter password prompt)

# (server):
sudo vim /etc/ssh/sshd_config # (interactive prompt, set the following:)
# ChallengeResponseAuthentication no
# PasswordAuthentication no
# UsePAM no
# PermitRootLogin no
/etc/init.d/ssh reload # interactive prompt: requires password

# Installing docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker jane
newgrp docker
sudo service docker restart

# Logging in
echo $CR_PAT | docker login ghcr.io -u USERNAME --password-stdin

# Installing docker-compose
# See: https://docs.docker.com/engine/install/debian/#install-using-the-repository
sudo apt-get install \
    ca-certificates \
    curl \
    gnupg \
    lsb-release
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update

sudo curl -L "https://github.com/docker/compose/releases/download/1.29.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Rules
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw limit ssh # allow with rate-limiting!
sudo ufw allow 'WWW Full'
sudo ufw allow qBittorrent/dns/bonjour/'kerberos full' # (optional)
sudo ufw enable

# Need to write rules again for docker since it ignores it
sudo wget -O /usr/local/bin/ufw-docker https://github.com/chaifeng/ufw-docker/raw/master/ufw-docker
sudo chmod +x /usr/local/bin/ufw-docker
sudo ufw-docker install

# After starting containers: https://github.com/chaifeng/ufw-docker#solving-ufw-and-docker-issues
sudo ufw-docker allow traefik 80/tcp
sudo ufw-docker allow traefik 443/tcp

sudo apt install jq

# Swap
## Create Swap
sudo dd if=/dev/zero of=/swapfile bs=1024 count=1048576 # 1GB
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

sudo vim /etc/fstab # add: /swapfile none swap sw 0 0

## Setting Swappiness
sudo sysctl vm.swappiness=30
sudo vim /etc/sysctl.conf # set vm.swappiness=30
```
