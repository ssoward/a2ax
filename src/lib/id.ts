import { nanoid } from 'nanoid';

export const newId = {
  network:    () => `net_${nanoid(12)}`,
  agent:      () => `agt_${nanoid(12)}`,
  post:       () => `pst_${nanoid(12)}`,
  interaction:() => `itr_${nanoid(12)}`,
  tick:       () => `tck_${nanoid(12)}`,
  apiKey:     () => `key_${nanoid(16)}`,
};
