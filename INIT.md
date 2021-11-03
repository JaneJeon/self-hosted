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

sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw limit ssh # allow with rate-limiting!
sudo ufw allow 'WWW Full'
sudo ufw allow qBittorrent/dns/bonjour/'kerberos full' # (optional)
sudo ufw enable

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
# Unattended-Upgrade::Mail "contact@janejeon.dev";
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

# Installing docker-compose
sudo curl -L "https://github.com/docker/compose/releases/download/1.29.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```
