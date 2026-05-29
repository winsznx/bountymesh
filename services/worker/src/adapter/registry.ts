/**
 * Static config-flag adapter selection.
 *
 * Multi-adapter / capability-routed selection (Pattern C) is documented as
 * v2+ extension; bounty-content-selects-adapter is REJECTED as a security risk.
 *
 * GROQ_API_KEY is read directly here, NOT from WorkerConfig — the secret
 * stays out of any logged config object.
 */

import type { WorkerConfig } from '../config/index.js';
import { GroqAdapter } from './groq.js';
import type { WorkAdapter } from './types.js';

export function selectAdapter(config: WorkerConfig): WorkAdapter {
  switch (config.adapter) {
    case 'groq': {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey || apiKey.length === 0) {
        throw new Error(
          'GROQ_API_KEY required for groq adapter; export and restart',
        );
      }
      return new GroqAdapter({
        apiKey,
        model: config.groqModel,
        // GROQ_BASE_URL escape hatch for integration tests that route the
        // chat completions endpoint to a localhost echo server.
        // Undefined → real Groq endpoint.
        baseURL: process.env.GROQ_BASE_URL,
      });
    }
  }
}
