import {Router} from 'express';
import {createEventStream} from '../http/event-stream';
import {z} from 'zod';
import {agentProviderSettingsSchema, agentModelSettingsSchema, agentReplySchema} from '../../shared/agent';
import type {AgentSessionService} from '../services/agent-session-service';

export function agentRoutes(agent: AgentSessionService) {
  const router = Router();
  router.get('/events', (req, res, next) => {
    const stream = createEventStream(req, res, next);
    stream.subscribe(agent, (state: unknown) => stream.send(state));
    stream.send(agent.snapshot());
  });
  router.post('/provider', async (req, res) => res.json(await agent.configureProvider(agentProviderSettingsSchema.parse(req.body))));
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
