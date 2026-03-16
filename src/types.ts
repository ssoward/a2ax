export type NetworkStatus = 'pending' | 'running' | 'paused' | 'completed';
export type AgentModel = 'claude-haiku-4-5-20251001' | 'claude-sonnet-4-6';
export type ActionType = 'post' | 'reply' | 'repost' | 'like' | 'follow' | 'unfollow' | 'idle';
export type InteractionType = 'like' | 'repost';
export type ApiKeyTier = 'reader' | 'writer' | 'admin';

export interface Network {
  id: string;
  name: string;
  topic: string;
  status: NetworkStatus;
  tick_interval_seconds: number;
  max_ticks: number;
  current_tick: number;
  total_tokens_used: number;
  total_cost_usd: number;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
}

export interface Agent {
  id: string;
  network_id: string | null;
  handle: string;
  display_name: string;
  bio: string;
  persona_prompt: string;
  interests: string[];
  model: AgentModel;
  token_budget: number;
  tokens_used: number;
  post_count: number;
  follower_count: number;
  following_count: number;
  like_count: number;
  is_active: boolean;
  is_external: boolean;
  created_at: Date;
}

export interface Post {
  id: string;
  network_id: string;
  author_id: string;
  author_handle?: string;
  author_display_name?: string;
  content: string;
  reply_to_id: string | null;
  repost_of_id: string | null;
  like_count: number;
  reply_count: number;
  repost_count: number;
  created_at: Date;
}

export interface Interaction {
  id: string;
  network_id: string;
  type: InteractionType;
  actor_id: string;
  target_post_id: string | null;
  target_agent_id: string | null;
  created_at: Date;
}

export interface Follow {
  follower_id: string;
  followee_id: string;
  created_at: Date;
}

export interface AgentTick {
  id: string;
  network_id: string;
  agent_id: string;
  tick_number: number;
  action: ActionType;
  post_id: string | null;
  tokens_used: number;
  cost_usd: number;
  created_at: Date;
}

export interface ApiKey {
  id: string;
  key_hash: string;
  key_prefix: string;
  label: string;
  is_active: boolean;
  tier: ApiKeyTier;
  requests_today: number;
  tokens_today: number;
  last_used_at: Date | null;
  created_at: Date;
  revoked_at: Date | null;
  agent_id: string | null;
}

// AI decision output
export interface AgentDecision {
  action: ActionType;
  content?: string;
  target_id?: string;
}

// Persona definition (used in seed data)
export interface PersonaDefinition {
  handle: string;
  display_name: string;
  bio: string;
  persona_prompt: string;
  interests: string[];
  model?: AgentModel;
}
