export async function connectLive() {
    const pc = new RTCPeerConnection();
  
    const audio = document.createElement("audio");
  
    audio.autoplay = true;
  
    pc.ontrack = (event) => {
      audio.srcObject = event.streams[0];
    };
  
    const localStream =
      await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
  
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }
  
    const dataChannel =
      pc.createDataChannel("lumi-events");
  
    const offer =
      await pc.createOffer();
  
    await pc.setLocalDescription(offer);
  
    const response = await fetch(
      "http://localhost:8787/api/live/session",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sdp: offer.sdp,
        }),
      },
    );
  
    if (!response.ok) {
      throw new Error(await response.text());
    }
  
    const live = await response.json();
  
    await pc.setRemoteDescription({
      type: "answer",
      sdp: live.transport.sdp,
    });

    async function handleDelegation(
        event: any,
      ) {
        const delegationId =
          event.delegation.id;
      
        const context =
          event.delegation.context;
      
        const result = await fetch(
          "http://localhost:8787/api/hermes",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              input:
                typeof context === "string"
                  ? context
                  : JSON.stringify(context),
      
              sessionId:
                "lumi-main",
            }),
          },
        );
      
        const {
          output,
        } = await result.json();
      
        dataChannel.send(
          JSON.stringify({
            type:
              "session.commentary.append",
      
            delegation_id:
              delegationId,
      
            content:
              output,
          }),
        );
      }
    
    dataChannel.addEventListener(
        "message",
        async (event) => {
          const message =
            JSON.parse(event.data);
      
          console.log("LIVE EVENT", message);
      
          if (
            message.type ===
            "delegation.created"
          ) {
            await handleDelegation(message);
          }
        },
      );
  
    return {
      pc,
      dataChannel,
      audio,
      sessionId: live.session.id,
    };
  }