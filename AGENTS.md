# AGENTS.md

- Lee primero `docs/base-conocimiento.md`: requisitos (RF01-RF28, RNF01-RNF14), casos de uso (CU01-CU25), reglas (RN01-RN12), seguridad y pantallas. Todo lo que se construya debe trazarse a esos IDs.
- La arquitectura acordada está en `docs/arquitectura.md`; las decisiones menores, en `docs/decisiones.md` (ADR cortos).
- Interfaz, documentación, mensajes y commits en español.
- Commits pequeños con formato convencional (`feat:`, `fix:`, `test:`, `chore:`, `docs:`), **sin líneas Co-Authored-By** ni otras atribuciones.
- Secretos solo en `.env` (no versionado); `.env.example` sin valores reales.
