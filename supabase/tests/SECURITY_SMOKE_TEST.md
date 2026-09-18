# MushroomApp security smoke test

Ta test izvedi po obeh migracijah v razvojnem Supabase projektu. Uporabi tri običajne `authenticated` seje A, B in C. Ne uporabljaj `service_role`, ker ta namenoma obide RLS.

## Priprava

1. Registriraj in potrdi A, B, C.
2. Z A pošlji friend request B.
3. Z B pokliči `respond_to_friend_request(<request-id>, 'accepted')`.
4. C naj ne bo prijatelj A.
5. Z A prek aplikacije ustvari tri obiske: `private`, `friends`, `community`. Zapomni si njihove UUID-je.

## Pričakovano branje

Za vsako sejo pokliči običajen Supabase client (publishable/anon ključ + uporabnikov access token):

```ts
await supabase.from('finds').select('id,owner_id,visibility,observation_latitude,observation_longitude')
await supabase.rpc('get_shared_find_cards', { p_scope: 'community', p_offset: 0, p_limit: 20 })
```

Pričakovano:

| Zapis A | A | B (prijatelj) | C (ni prijatelj) |
|---|---|---|---|
| private raw | vidi exact | ne vidi | ne vidi |
| friends raw | vidi exact | vidi exact | ne vidi |
| community raw | vidi exact kot owner | ne vidi | ne vidi |
| community RPC | vidi varno kartico | vidi varno kartico | vidi varno kartico |

V rezultatu `get_shared_find_cards` ne sme biti nobenega ključa `latitude`, `longitude`, `observation_latitude` ali `observation_longitude`.

## Prepovedane spremembe

Kot B poskusi:

```ts
await supabase.from('finds').update({ notes: 'napad' }).eq('id', A_FIND_ID)
await supabase.from('finds').delete().eq('id', A_FIND_ID)
await supabase.from('finds').update({ owner_id: B_ID }).eq('id', A_FIND_ID)
```

Vsi morajo spremeniti `0` vrstic ali vrniti authorization/RLS napako. Nato kot A preveri, da zapis ni spremenjen.

Kot C poskusi sam ustvariti sprejeto prijateljstvo:

```ts
await supabase.from('friendships').insert({ requester_id: C_ID, recipient_id: A_ID, status: 'accepted' })
```

INSERT mora biti zavrnjen, ker policy dovoljuje le `pending` in requester mora biti `auth.uid()`.

Kot C poskusi sprejeti request, ki je namenjen B:

```ts
await supabase.rpc('respond_to_friend_request', { friendship_id: A_TO_B_REQUEST_ID, response: 'accepted' })
```

Klic mora vrniti `friend request not found or not authorized`.

Kot B poskusi neposreden UPDATE udeležencev:

```ts
await supabase.from('friendships').update({ requester_id: B_ID, recipient_id: A_ID }).eq('id', A_TO_B_REQUEST_ID)
```

Klic mora biti zavrnjen: authenticated nima neposrednega UPDATE privilegija, trigger pa dodatno zamrzne oba udeleženca in ID.

## Storage

1. Kot B poskusi upload v `A_ID/...` — zavrnjeno.
2. Kot B preberi fotografijo A private obiska — zavrnjeno.
3. Kot B preberi fotografijo A friends obiska — dovoljeno po sprejetju.
4. Kot C preberi fotografijo A friends obiska — zavrnjeno.
5. Kot B ali C preberi fotografijo community kartice s signed URL-jem — dovoljeno, same metadata vrstice pa ne razkrijejo GPS.

## Zabeleži rezultat

Zapiši datum, project ref, UUID testnih uporabnikov in vsak PASS/FAIL. Če katerikoli test razkrije koordinato ali omogoči tujo spremembo, ustavi uporabo community/clouda in najprej popravi policy/funkcijo.
