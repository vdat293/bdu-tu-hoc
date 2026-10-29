// AWS regions offered in step 2 of the INF1003 guide. The lab creates its VPC,
// EC2 and RDS resources in whichever region the student picks, so students who
// are not near Singapore can keep latency and data location local.
//
// Only regions that carry the full lab stack are listed: CloudShell, T3
// instances (t3.micro), RDS MySQL db.t3.micro and Canonical's Ubuntu 24.04 AMI.
// Opt-in regions (ap-east-1, af-south-1, me-south-1, ...) are intentionally
// left out so a lab account that never enabled them cannot get stuck.
export const DEFAULT_REGION = 'ap-southeast-1';

export const GUIDE_REGIONS = [
  { code: 'ap-southeast-1', label: 'Asia Pacific (Singapore)', area: 'Châu Á – Thái Bình Dương' },
  { code: 'ap-southeast-2', label: 'Asia Pacific (Sydney)', area: 'Châu Á – Thái Bình Dương' },
  { code: 'ap-southeast-3', label: 'Asia Pacific (Jakarta)', area: 'Châu Á – Thái Bình Dương' },
  { code: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)', area: 'Châu Á – Thái Bình Dương' },
  { code: 'ap-northeast-2', label: 'Asia Pacific (Seoul)', area: 'Châu Á – Thái Bình Dương' },
  { code: 'ap-northeast-3', label: 'Asia Pacific (Osaka)', area: 'Châu Á – Thái Bình Dương' },
  { code: 'ap-south-1', label: 'Asia Pacific (Mumbai)', area: 'Châu Á – Thái Bình Dương' },
  { code: 'us-east-1', label: 'US East (N. Virginia)', area: 'Châu Mỹ' },
  { code: 'us-east-2', label: 'US East (Ohio)', area: 'Châu Mỹ' },
  { code: 'us-west-2', label: 'US West (Oregon)', area: 'Châu Mỹ' },
  { code: 'ca-central-1', label: 'Canada (Central)', area: 'Châu Mỹ' },
  { code: 'sa-east-1', label: 'South America (São Paulo)', area: 'Châu Mỹ' },
  { code: 'eu-west-1', label: 'Europe (Ireland)', area: 'Châu Âu' },
  { code: 'eu-west-2', label: 'Europe (London)', area: 'Châu Âu' },
  { code: 'eu-central-1', label: 'Europe (Frankfurt)', area: 'Châu Âu' },
  { code: 'eu-north-1', label: 'Europe (Stockholm)', area: 'Châu Âu' }
];

const REGION_PATTERN = /^[a-z]{2}(?:-[a-z]+)+-\d$/;

export function isValidRegion(code) {
  return REGION_PATTERN.test(String(code ?? ''));
}

export function normalizeRegion(code) {
  return isValidRegion(code) ? String(code) : DEFAULT_REGION;
}

export function regionLabel(code) {
  return GUIDE_REGIONS.find((region) => region.code === code)?.label
    || (isValidRegion(code) ? code : 'Asia Pacific (Singapore)');
}

// Rewrite the region baked into the CloudShell scripts so the copied one-liner
// creates resources where the student chose. CloudShell already exports its own
// AWS_DEFAULT_REGION/AWS_REGION for the console region, so the `${VAR:-default}`
// fallback in the script would never apply: replace the whole line with an
// explicit export of both variables.
export function applyScriptRegion(script, region) {
  const text = String(script ?? '');
  if (!isValidRegion(region)) return text;
  return text.replace(
    /^export AWS_DEFAULT_REGION="\$\{AWS_DEFAULT_REGION:-[^}]+\}"$/m,
    `export AWS_DEFAULT_REGION="${region}"\nexport AWS_REGION="$AWS_DEFAULT_REGION"`
  );
}
