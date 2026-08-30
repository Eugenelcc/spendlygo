// Render rejects an invalid blueprint only after you have connected the repo
// and waited for validation, so the feedback loop is slow and manual. These
// are the constraints that have actually bitten us, checked in CI instead.
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const blueprint = parse(readFileSync('render.yaml', 'utf8'));
const problems = [];

blueprint.services.forEach((service, index) => {
  const at = `services[${index}] (${service.name})`;
  const isStatic = service.runtime === 'static';

  if (isStatic && 'plan' in service) {
    problems.push(
      `${at}: static sites have no instance plan — remove \`plan\`. ` +
        'Render fails with "no such plan free for service type web".',
    );
  }

  if (!isStatic && service.plan !== 'free') {
    problems.push(`${at}: plan is "${service.plan}", not free. GUARDRAILS.md section 1.`);
  }

  if (isStatic && !service.staticPublishPath) {
    problems.push(`${at}: a static site needs staticPublishPath.`);
  }

  if (!isStatic && !service.healthCheckPath) {
    problems.push(`${at}: a web service needs healthCheckPath, or Render cannot tell it is up.`);
  }
});

// GUARDRAILS.md section 1: one always-on web service uses ~730 of the 750 free
// instance hours. A second one starts a bill.
const alwaysOn = blueprint.services.filter((s) => s.runtime !== 'static');
if (alwaysOn.length > 1) {
  problems.push(
    `${alwaysOn.length} non-static services (${alwaysOn.map((s) => s.name).join(', ')}). ` +
      'The free tier affords exactly one. See GUARDRAILS.md section 1.',
  );
}

if (problems.length > 0) {
  console.error('render.yaml problems:\n');
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}

console.log(
  `✓ render.yaml valid — ${blueprint.services.length} services, ` +
    `${alwaysOn.length} always-on, all free.`,
);
