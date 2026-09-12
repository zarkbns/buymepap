import { createApp } from './app.js';
import config from './config.js';

const app = createApp();

app.listen(config.port, () => {
  console.log(`[buymepap] ${config.env} · payments=${config.paystackMode} · http://localhost:${config.port}`);
});
