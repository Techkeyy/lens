# Prover runtime test: runbook

Every command here is **run by you, not by me**. I do not create paid resources.
Nothing in this document broadcasts a STRK20 transaction.

The one chain expenditure is the throwaway account deployment, **0.1308 STRK**
estimated live, and it is separately approved.

---

# What is being tested

Whether `transaction-prover:PRIVACY-0.14.3-RC.2` produces a proof carrying the
virtual-OS program hash that mainnet actually accepts.

| | |
| --- | --- |
| Pool | `0x0403…812a`, class `0x67dddd89…b554d` |
| Pool source | `PRIVACY-0.14.3-RC.3`, class hash reproduced from source |
| SDK | `PRIVACY-0.14.3-RC.3`, commit `efc61cbbdab5b714b5cf915f9735d88948e2ea82` |
| Differential | **26/26 identical**, including `ComputeAndInvoke` |
| Prover image | `transaction-prover:PRIVACY-0.14.3-RC.2` |
| Digest | `sha256:a62e7764e034ea25d84d4a235f1f683f7c5f03f88f6646a744599171bf5ca58c` |
| Image revision | `e6b6fd2e9932909107833579e5b6efd6c75fa0af` |
| Expected program | `0x53f6c9fcfd31d27279ff7d7e422b44623550a732b59fe193354a7316a96daa1` |

The prover tag lags the pool tag on purpose. The prover does not depend on the
pool's class: it re-executes whatever is deployed. Its compatibility is
established by the program hash observed in live transactions, and RC.2 is both
the newest `PRIVACY-*` prover image and the one whose revision matches.

---

# Step 0. The throwaway account

Already generated locally. The key is in `.env.throwaway.local`, which git
ignores, and has never been printed.

| | |
| --- | --- |
| Address | `0x52d3e19fd64ac35bf5bdd5de38baed7bb23107fee4801afde8f92cd106060a2` |
| Public key | `0x668f3199407e770c7c9434ffac75f404208318e3844ab251599eeaafbc93654` |
| Account class | `0x061dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f` |
| Deploy fee, live estimate | **0.130814 STRK** |
| Fund with | **0.196220 STRK** (worst case plus 50%) |

**You send the funding.** From the Lens deployer, or any wallet:

```
send 0.1963 STRK to 0x52d3e19fd64ac35bf5bdd5de38baed7bb23107fee4801afde8f92cd106060a2
```

Then deploy it, and check it first:

```bash
cd /c/Users/HomePC/Desktop/lens && npx tsx scripts/throwaway-account.ts
```

```bash
cd /c/Users/HomePC/Desktop/lens && npx tsx scripts/throwaway-account.ts --deploy
```

---

# Step 1. Install the Google Cloud CLI

```bash
winget install --id Google.CloudSDK -e
```

Then, in a **new** terminal:

```bash
gcloud auth login
```

Tell me your **project id** afterwards. I do not need, and will not ask for, a
password, a service-account key, an OAuth token or billing details.

---

# Step 2. Zone availability, before anything is created

`c4d-highcpu-48` is not in every zone. Find one that has it:

```bash
gcloud compute machine-types list --filter="name=c4d-highcpu-48 AND zone~us-central1" --format="table(name,zone,guestCpus,memoryMb)"
```

If that returns nothing in `us-central1`, widen it and tell me the result:

```bash
gcloud compute machine-types list --filter="name=c4d-highcpu-48" --format="value(zone)"
```

---

# Step 3. Quota, before anything is created

48 vCPUs is above the default quota on many fresh projects. Check before
creating, because the failure otherwise arrives after the resource is half made:

```bash
gcloud compute regions describe us-central1 --format="table(quotas.metric,quotas.limit,quotas.usage)" | grep -Ei "CPUS|C4D"
```

You need headroom for **48 CPUs** in the region, plus one external IP.

**If quota blocks it, stop and tell me.** I will not silently substitute a
smaller machine: the requirement is 48 vCPU and 90 GB, and a weaker box would
either fail or produce a misleading result. The alternative would need your
approval first.

---

# Step 4. Create the VM

Replace `PROJECT_ID` and `ZONE` with your values. **Read the pre-flight block
below before running this.**

| | |
| --- | --- |
| Provider | Google Compute Engine |
| Machine type | `c4d-highcpu-48` |
| vCPU / RAM | 48 / 90 GB |
| Boot disk | 50 GB balanced persistent, no local SSD |
| Billing | on-demand, **not** Spot |
| Public IPv4 | **yes, ephemeral**, for SSH only. No static IP. |
| Open ports | none added. Port 3000 is never exposed. |
| Accelerators | none |
| Resource name | `lens-prover-test` |
| Compute rate | about **1.9076 USD/hour** in us-central1 |

```bash
gcloud compute instances create lens-prover-test --project=PROJECT_ID --zone=ZONE --machine-type=c4d-highcpu-48 --image-family=debian-12 --image-project=debian-cloud --boot-disk-size=50GB --boot-disk-type=pd-balanced --no-restart-on-failure --maintenance-policy=TERMINATE --scopes=default
```

No firewall rule is created. The prover is reached over the SSH tunnel in step 7,
never over the internet.

---

# Step 5. Docker, and verify the image before running it

```bash
gcloud compute ssh lens-prover-test --project=PROJECT_ID --zone=ZONE --command="curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker \$USER"
```

Pull **by digest**, then confirm the revision label independently:

```bash
gcloud compute ssh lens-prover-test --project=PROJECT_ID --zone=ZONE --command="sudo docker pull ghcr.io/starkware-libs/starknet-privacy/transaction-prover@sha256:a62e7764e034ea25d84d4a235f1f683f7c5f03f88f6646a744599171bf5ca58c && sudo docker inspect --format='{{index .Config.Labels \"org.opencontainers.image.revision\"}}' ghcr.io/starkware-libs/starknet-privacy/transaction-prover@sha256:a62e7764e034ea25d84d4a235f1f683f7c5f03f88f6646a744599171bf5ca58c"
```

It must print exactly:

```
e6b6fd2e9932909107833579e5b6efd6c75fa0af
```

**If it does not, stop.** Do not run the container.

---

# Step 6. Start the prover

Bound to localhost inside the VM. One proof at a time. No interceptor, no
discovery service, no mounted host directories, no secrets in the environment.

```bash
gcloud compute ssh lens-prover-test --project=PROJECT_ID --zone=ZONE --command="sudo docker run -d --name prover -p 127.0.0.1:3000:3000 -e RPC_URL=https://api.cartridge.gg/x/starknet/mainnet -e CHAIN_ID=SN_MAIN -e MAX_CONCURRENT_REQUESTS=1 -e PREFETCH_STATE=true ghcr.io/starkware-libs/starknet-privacy/transaction-prover@sha256:a62e7764e034ea25d84d4a235f1f683f7c5f03f88f6646a744599171bf5ca58c"
```

Health, from inside the VM:

```bash
gcloud compute ssh lens-prover-test --project=PROJECT_ID --zone=ZONE --command="curl -s -X POST http://127.0.0.1:3000 -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"starknet_specVersion\",\"params\":[]}'"
```

Expect `"result":"0.10.0"`.

---

# Step 7. Tunnel, then run the test

Leave this running in its own terminal:

```bash
gcloud compute ssh lens-prover-test --project=PROJECT_ID --zone=ZONE -- -N -L 3000:127.0.0.1:3000
```

In another terminal:

```bash
cd /c/Users/HomePC/Desktop/lens && PROVER_URL=http://127.0.0.1:3000 npx tsx scripts/prover-compat-test.ts
```

That script has **no submission path**. It checks the chain, the pool class, the
live accepted program hash, the throwaway account and the prover's own version,
then asks for one proof and compares the program hash it comes back with.

Send me the output.

---

# Step 8. Delete the VM immediately

Do not leave a 48-vCPU machine running while we read the result.

```bash
gcloud compute instances delete lens-prover-test --project=PROJECT_ID --zone=ZONE --quiet
```

Confirm it is gone:

```bash
gcloud compute instances list --project=PROJECT_ID --filter="name=lens-prover-test"
```

---

# What happens after a pass

**Nothing automatic.** A pass means the prover stack is validated, not that the
production registration is approved. That is a separate decision, and the
production Lens viewing key stays unused until it is made.

The throwaway account can be abandoned. It holds only leftover gas and its
registration slot is irrelevant, which was the entire point of using it.
