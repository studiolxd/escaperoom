/** Forma mínima del usuario que necesita `/api/me` (specs/13 §2). */
export type MeUser = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  locale: string;
  isAdmin: boolean;
  isModerator: boolean;
  creditAccount: { userId: string | null; balanceCredits: bigint }[];
  member: {
    role: string;
    organization: { id: string; name: string; slug: string };
  }[];
};

export type MeResponse = {
  user: {
    id: string;
    email: string;
    name: string;
    image: string | null;
    locale: string;
    isAdmin: boolean;
    isModerator: boolean;
  };
  personalCredits: number;
  organizations: { id: string; name: string; slug: string; role: string }[];
};

/** Mapea el usuario a la respuesta de `/api/me` (pura, testeable). */
export function toMeResponse(user: MeUser): MeResponse {
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      locale: user.locale,
      isAdmin: user.isAdmin,
      isModerator: user.isModerator,
    },
    personalCredits: Number(user.creditAccount.find((a) => a.userId)?.balanceCredits ?? 0n),
    organizations: user.member.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      role: m.role,
    })),
  };
}
