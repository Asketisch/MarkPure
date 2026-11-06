<!--
  Settings → About section.

  Static info card — app name, description, version. No
  callbacks. Kept as a separate component so the future
  changelog / "check for updates" UI has a place to live
  without re-bloating Settings.svelte.
-->

<script lang="ts">
  import { useI18n } from '$lib/stores/i18n.svelte'

  const i18n = useI18n()
</script>

<section>
  <h2>{i18n.t('settings.about')} {i18n.t('app.name')}</h2>
  <div class="about-info">
    <h1>{i18n.t('app.name')}</h1>
    <p>{i18n.t('app.description')}</p>
    <p class="version">v0.1.1</p>
  </div>
</section>