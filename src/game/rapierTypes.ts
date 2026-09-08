import type { useRapier } from '@react-three/rapier';

/**
 * Two copies of @dimforge/rapier3d-compat can end up installed (one nested
 * under @react-three/rapier), and their Collider classes are nominally
 * incompatible. Deriving the type from the world instance we actually get at
 * runtime keeps query filter predicates typed against the right one.
 */
type RapierContext = ReturnType<typeof useRapier>;

export type RapierWorld = RapierContext['world'];

export type RapierCollider = NonNullable<
  ReturnType<RapierWorld['getCollider']>
>;
