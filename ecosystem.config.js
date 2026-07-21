module.exports = {
  apps: [
    {
      name: 'mos-pub',
      script: 'server.js',
      interpreter: 'node',
      interpreter_args: '--experimental-sqlite',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        // Définir ces variables dans /var/www/mos/.env sur le VPS
        // ou les exporter dans l'environnement avant de lancer PM2
        SESSION_SECRET: process.env.SESSION_SECRET || '',
        DEPLOY_TOKEN:   process.env.DEPLOY_TOKEN   || '',
        PLANNING_RECIPIENT: process.env.PLANNING_RECIPIENT || '',
        PAUL_EMAIL:     process.env.PAUL_EMAIL     || '',
      },
      watch: false,
      max_memory_restart: '300M',
      restart_delay: 3000,
      min_uptime: '5s',
      max_restarts: 10,
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ]
};
