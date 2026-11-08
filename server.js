ALTER TABLE public.links
ADD COLUMN IF NOT EXISTS clicks BIGINT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.increment_link_clicks(link_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  destination TEXT;
BEGIN
  UPDATE public.links
  SET clicks = clicks + 1
  WHERE code = link_code
  RETURNING original_url INTO destination;

  RETURN destination;
END;
$$;

GRANT EXECUTE ON FUNCTION
public.increment_link_clicks(TEXT)
TO service_role;