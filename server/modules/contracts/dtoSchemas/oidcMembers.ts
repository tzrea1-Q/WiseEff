import { z } from "zod";

const subjectSchema = z.string().min(1).max(255).refine((subject) => subject.trim().length > 0, "Subject cannot be blank.");
export const oidcIdentitySchema = z.object({ issuer: z.string().min(1),subject: subjectSchema }).strict();
export const setOidcIdentityBodySchema = oidcIdentitySchema.extend({ email: z.string().email().optional(),expectedIdentity: oidcIdentitySchema.nullable() }).strict();
export const oidcProvisionUserFieldsSchema = oidcIdentitySchema.extend({ authentication: z.literal("oidc"),name: z.string().trim().min(1),title: z.string().optional(),email: z.string().email().optional() }).strict();
