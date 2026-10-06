import { Router } from 'express';
import { answerApplicationQuestion, getAssistantStatus } from '../../services/assistant.service.js';
import { HttpError } from '../../errors/httpError.js';

export const assistantRouter = Router();

assistantRouter.get('/status', (req, res) => {
  res.json(getAssistantStatus());
});

assistantRouter.post('/', async (req, res, next) => {
  try {
    const { question, context } = req.body ?? {};
    if (question == null) throw new HttpError(400, 'Informe a pergunta no corpo JSON.');
    const result = await answerApplicationQuestion({
      question,
      context,
      clientId: req.ip || req.socket.remoteAddress || 'unknown',
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});