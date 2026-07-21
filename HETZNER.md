# Migration vers Hetzner Cloud

**Plan : CX22 — 3.29€/mois** (4 vCPU, 4 GB RAM, 40 GB SSD, Ubuntu 24.04)
Économie : ~17€/mois par rapport à l'ancienne solution.

---

## Étape 1 — Créer le VPS sur Hetzner

1. Aller sur [hetzner.com/cloud](https://www.hetzner.com/cloud)
2. Créer un compte → **Cloud Console**
3. Nouveau projet → **+ Create Server**
4. Choisir :
   - **Location** : Falkenstein (EU) ou Helsinki
   - **Image** : Ubuntu 24.04
   - **Type** : Shared CPU → **CX22** (3.29€/mois)
   - **SSH Key** : Coller ta clé publique Mac (voir ci-dessous)
   - **Name** : `mos-pub`
5. Cliquer **Create & Buy**

### Obtenir ta clé SSH publique (Mac)

```bash
cat ~/.ssh/id_ed25519.pub
```

Si elle n'existe pas :
```bash
ssh-keygen -t ed25519 -C "acapri.mospub@gmail.com"
cat ~/.ssh/id_ed25519.pub
```

---

## Étape 2 — Sauvegarder la DB depuis l'ancien VPS

**Avant de fermer l'ancien VPS**, récupère la base de données :

```bash
scp root@ANCIENNE_IP_HOSTINGER:/var/www/mos/db/mos.db \
  "/Users/arthurcapri/Documents/Maker of Simplicity/db/mos-backup-$(date +%Y%m%d).db"
```

---

## Étape 3 — Configurer le nouveau VPS Hetzner

Connecte-toi en SSH (avec l'IP affichée dans la console Hetzner) :

```bash
ssh root@NOUVELLE_IP_HETZNER
```

### 3a — Installer Node.js 24, PM2, Git

```bash
apt-get update && apt-get upgrade -y

# Node.js 24
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs git

# PM2
npm install -g pm2

# Vérifier
node --version   # v24.x.x
pm2 --version
```

### 3b — Cloner le projet

```bash
mkdir -p /var/www/mos
cd /var/www/mos
git clone https://github.com/acaprimospub-arch/makerofsimplicty.git .
npm install --production
```

### 3c — Créer le fichier .env

```bash
# Générer les secrets
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# → copier la valeur pour SESSION_SECRET

node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# → copier la valeur pour DEPLOY_TOKEN

cat > /var/www/mos/.env << 'EOF'
NODE_ENV=production
PORT=3000
SESSION_SECRET=REMPLACER_PAR_LA_VALEUR_GENEREE
DEPLOY_TOKEN=REMPLACER_PAR_LA_VALEUR_GENEREE
PLANNING_RECIPIENT=pverdier.mospub@gmail.com
PAUL_EMAIL=pverdier.mospub@gmail.com
EOF

chmod 600 /var/www/mos/.env
```

### 3d — Transférer la base de données

Depuis ton Mac :
```bash
scp "/Users/arthurcapri/Documents/Maker of Simplicity/db/mos-backup-XXXXXX.db" \
  root@NOUVELLE_IP_HETZNER:/var/www/mos/db/mos.db
```

### 3e — Démarrer l'app

```bash
cd /var/www/mos
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # → copier-coller la commande affichée pour le démarrage auto
```

Vérifier : `pm2 status` → l'app doit être en **online**

Tester dans le navigateur : `http://NOUVELLE_IP_HETZNER:3000`

---

## Étape 4 — Mettre à jour GitHub Actions

### 4a — Ajouter la clé SSH privée dans les secrets GitHub

Sur ton Mac :
```bash
cat ~/.ssh/id_ed25519
```
Copier tout le contenu (de `-----BEGIN...` à `-----END...`).

Dans le repo GitHub → **Settings → Secrets and variables → Actions** → mettre à jour :

| Secret | Valeur |
|---|---|
| `VPS_HOST` | Nouvelle IP Hetzner |
| `VPS_USER` | `root` |
| `VPS_SSH_KEY` | Contenu de `~/.ssh/id_ed25519` (clé privée) |

Supprimer `VPS_PASSWORD` (on passe à SSH key, plus sécurisé).

### 4b — Mettre à jour deploy.yml

Le fichier `.github/workflows/deploy.yml` a déjà été mis à jour dans le repo pour utiliser SSH key.

---

## Étape 5 — Tester le déploiement automatique

```bash
cd "/Users/arthurcapri/Documents/Maker of Simplicity"
git add .
git commit -m "feat: migration Hetzner"
git push
```

→ Aller dans GitHub → **Actions** → vérifier que le déploiement passe au vert.

---

## Étape 6 — Fermer l'ancien VPS Hostinger

Une fois que tout fonctionne sur Hetzner :
1. Hostinger → Tableau de bord VPS → **Résilier**
2. Économie : ~17€/mois

---

## Commandes utiles (SSH Hetzner)

```bash
pm2 status              # État
pm2 logs mos-pub        # Logs en temps réel
pm2 reload mos-pub      # Redémarrer (sans coupure)
pm2 restart mos-pub     # Redémarrage dur

# Mise à jour manuelle
cd /var/www/mos && git pull && npm install --production && pm2 reload mos-pub

# Backup DB vers Mac
scp root@NOUVELLE_IP_HETZNER:/var/www/mos/db/mos.db \
  "/Users/arthurcapri/Documents/Maker of Simplicity/db/backup-$(date +%Y%m%d).db"
```

---

## Optionnel — Domaine personnalisé + HTTPS

Si tu as un domaine :
```bash
apt-get install -y nginx certbot python3-certbot-nginx

# Config Nginx (reverse proxy port 3000 → 80/443)
cat > /etc/nginx/sites-available/mos-pub << 'NGINX'
server {
    listen 80;
    server_name TON_DOMAINE.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINX

ln -s /etc/nginx/sites-available/mos-pub /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# SSL gratuit
certbot --nginx -d TON_DOMAINE.com
```
