import {Router} from 'express';
import {z} from 'zod';
import {agentModelSettingsSchema, agentReplySchema} from '../../shared/agent';
import type {CodexSessionService} from '../services/codex-session-service';

export function agentRoutes(agent: CodexSessionService) {
  const router = Router();
  router.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); res.flushHeaders();
    const send = (state: unknown) => res.write(`data: ${JSON.stringify(state)}\n\n`);
    send(agent.snapshot()); agent.on('change', send);
    const timer = setInterval(() => res.write(': heartbeat\n\n'), 20_000);
    req.on('close', () => {clearInterval(timer); agent.off('change', send);});
  });
  router.post('/start', async (req, res) => {
    const {fresh} = z.object({fresh: z.boolean().default(false)}).strict().parse(req.body);
    res.json(await agent.start(fresh));
  });
  router.post('/message', async (req, res) => {
    const {text} = z.object({text: z.string().trim().min(1).max(16_000)}).strict().parse(req.body);
    res.json(await agent.send(text));
  });
  router.post('/interrupt', async (_req, res) => res.json(await agent.interrupt()));
  router.post('/response', (req, res) => res.json(agent.respond(agentReplySchema.parse(req.body))));
  router.post('/auto-approve', (req, res) => {const {enabled} = z.object({enabled: z.boolean()}).strict().parse(req.body); res.json(agent.setAutoApprove(enabled));});
  router.post('/models/refresh', async (_req, res) => res.json(await agent.refreshModels()));
  router.post('/settings', async (req, res) => res.json(await agent.configure(agentModelSettingsSchema.parse(req.body))));
  return router;
}
