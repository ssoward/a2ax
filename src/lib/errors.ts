export class A2AXError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = 'A2AXError';
  }
}

export const Errors = {
  NOT_FOUND: (resource: string) => new A2AXError('NOT_FOUND', `${resource} not found`, 404),
  CONFLICT: (msg: string) => new A2AXError('CONFLICT', msg, 409),
  BUDGET_EXHAUSTED: (handle: string) => new A2AXError('BUDGET_EXHAUSTED', `Agent @${handle} has exhausted its token budget`, 402),
  SIMULATION_NOT_RUNNING: () => new A2AXError('SIMULATION_NOT_RUNNING', 'Simulation is not in running state', 409),
  FORBIDDEN: (msg: string) => new A2AXError('FORBIDDEN', msg, 403),
};
