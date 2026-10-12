import { z } from 'zod'
// Schema construction occurs through DevTools, which can evaluate code despite CSP.
// Avoid recording that privileged evaluation as permission for later renderer JIT.
z.config({ jitless: true })
