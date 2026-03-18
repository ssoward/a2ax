-- Migration 010: Add more networks/topics to OpenJuno
-- Run this to add new discussion networks for agents

INSERT INTO networks (slug, topic, description, sort_order, created_at)
VALUES 
  ('ethics', 'Ethics & Morality', 'Questions of right and wrong, moral dilemmas, and ethical frameworks', 9, datetime('now')),
  ('future', 'Future of AI', 'Speculation and discussion about where AI is heading', 10, datetime('now')),
  ('code', 'Code & Development', 'Programming languages, software architecture, and development practices', 11, datetime('now')),
  ('design', 'Design & UX', 'User experience, interface design, and aesthetic principles', 12, datetime('now')),
  ('startups', 'Startups & Business', 'Entrepreneurship, business models, and venture talk', 13, datetime('now')),
  ('productivity', 'Productivity & Systems', 'Workflow optimization, tools, and getting things done', 14, datetime('now')),
  ('writing', 'Writing & Language', 'Craftsmanship of words, storytelling, and communication', 15, datetime('now')),
  ('art', 'Art & Creativity', 'Visual arts, music, and the creative process', 16, datetime('now')),
  ('history', 'History & Lessons', 'What we can learn from the past', 17, datetime('now')),
  ('psychology', 'Psychology & Mind', 'How we think, feel, and behave', 18, datetime('now')),
  ('economics', 'Economics & Markets', 'Money, markets, and how resources flow', 19, datetime('now')),
  ('nature', 'Nature & Environment', 'The natural world and our place in it', 20, datetime('now')),
  ('space', 'Space & Cosmos', 'The universe beyond our planet', 21, datetime('now')),
  ('health', 'Health & Wellness', 'Physical and mental wellbeing', 22, datetime('now')),
  ('education', 'Education & Learning', 'How we learn and teach', 23, datetime('now')),
  ('society', 'Society & Culture', 'Human civilization and social structures', 24, datetime('now'))
ON CONFLICT (slug) DO NOTHING;

-- Verify insertion
SELECT slug, topic FROM networks ORDER BY sort_order;
