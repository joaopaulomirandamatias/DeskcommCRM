-- 0275 — atraso humano configurável por conexão (#653)
--
-- Os quatro números que dimensionam a pausa antes da primeira bolha viviam
-- cravados em `atraso-humano.ts`. NULL preserva exatamente os defaults do código,
-- então aplicar esta migration não muda o ritmo de nenhuma conexão existente.

alter table public.channel_knobs
  add column if not exists human_delay_base_ms integer,
  add column if not exists human_delay_ms_per_char integer,
  add column if not exists human_delay_min_ms integer,
  add column if not exists human_delay_max_ms integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'channel_knobs_human_delay_nonnegative'
  ) then
    alter table public.channel_knobs
      add constraint channel_knobs_human_delay_nonnegative check (
        (human_delay_base_ms is null or human_delay_base_ms >= 0) and
        (human_delay_ms_per_char is null or human_delay_ms_per_char >= 0) and
        (human_delay_min_ms is null or human_delay_min_ms >= 0) and
        (human_delay_max_ms is null or human_delay_max_ms >= 0)
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'channel_knobs_human_delay_range'
  ) then
    alter table public.channel_knobs
      add constraint channel_knobs_human_delay_range check (
        human_delay_min_ms is null or human_delay_max_ms is null or
        human_delay_min_ms <= human_delay_max_ms
      );
  end if;
end $$;

comment on column public.channel_knobs.human_delay_base_ms is
  'Parcela fixa da pausa humana antes da primeira bolha; NULL usa o default do engine.';
comment on column public.channel_knobs.human_delay_ms_per_char is
  'Milissegundos por caractere somados à pausa humana; NULL usa o default do engine.';
comment on column public.channel_knobs.human_delay_min_ms is
  'Piso da pausa humana; NULL usa o default do engine.';
comment on column public.channel_knobs.human_delay_max_ms is
  'Teto da pausa humana; NULL usa o default do engine.';
