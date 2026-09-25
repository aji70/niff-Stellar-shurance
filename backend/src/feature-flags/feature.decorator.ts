import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { FEATURE_METADATA_KEY } from './constants';
import { FeatureFlagsGuard } from './feature-flags.guard';

/**
 * Marks a route as gated behind a feature flag.
 *
 * The flag name is stored as route metadata and enforced by
 * {@link FeatureFlagsGuard}, which evaluates the flag for the caller
 * (boolean, percentage rollout or allowlist) before the handler runs.
 */
export function Feature(featureName: string) {
  return applyDecorators(
    SetMetadata(FEATURE_METADATA_KEY, featureName),
    UseGuards(FeatureFlagsGuard),
  );
}
