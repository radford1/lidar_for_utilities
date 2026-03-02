import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import DatabricksSql from './databricks_sql.js';
import h3Router from './routes/h3.js';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
app.use(express.json());
app.use(cors({ origin: '*'}));

const db = new DatabricksSql({});

app.set('db', db);

app.use('/api', (req, _res, next) => { req.db = db; next(); }, h3Router);

// Serve static client build in production
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDist = path.resolve(__dirname, './public');
app.use(express.static(clientDist));

// SPA fallback to index.html (after API and static)
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
