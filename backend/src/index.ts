import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { immichRouter } from './routes/immich';
import { editRouter } from './routes/edit';
import { settingsRouter } from './routes/settings';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.BACKEND_PORT || '3778', 10);

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/immich', immichRouter);
app.use('/api/edit', editRouter);
app.use('/api/settings', settingsRouter);

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[ERROR]', err.message, err.stack);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Immich AI Editor Backend running on port ${PORT}`);
  console.log(`   Immich internal URL: ${process.env.IMMICH_INTERNAL_URL}`);
  console.log(`   Active providers: ${[
    process.env.FAL_KEY ? 'Fal.ai' : null,
    process.env.RUNWARE_API_KEY ? 'Runware' : null,
    process.env.REPLICATE_API_TOKEN ? 'Replicate' : null,
    process.env.ATLAS_API_KEY ? 'Atlas Cloud' : null,
  ].filter(Boolean).join(', ') || 'none configured'}\n`);
});

export default app;
