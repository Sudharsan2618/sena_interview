// WebRTC connection handler
class WebRTCConnection {
    constructor() {
      this.pc = null;
      this.dc = null;
      this.audioElement = null;
      this.localStream = null;
      this.ephemeralKey = null;
      this.currentInstructions = null;
      this.onTextEvent = null;
      this.onStatusChange = null;
    }
  
    async initialize() {
      try {
        // Get an ephemeral key from the server
        const tokenResponse = await fetch("http://127.0.0.1:5000/session");
        const data = await tokenResponse.json();
        
        if (data.error) {
          throw new Error(data.error);
        }
        
        this.ephemeralKey = data.client_secret.value;
        
        // Create a peer connection
        this.pc = new RTCPeerConnection();
        
        // Set up to play remote audio from the model
        this.audioElement = document.createElement("audio");
        this.audioElement.autoplay = true;
        this.pc.ontrack = e => {
          this.audioElement.srcObject = e.streams[0];
          if (this.onStatusChange) this.onStatusChange('connected');
        };
        
        // Add local audio track for microphone input
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: true
        });
        
        this.localStream.getTracks().forEach(track => {
          this.pc.addTrack(track, this.localStream);
        });
        
        // Set up data channel for sending and receiving events
        this.dc = this.pc.createDataChannel("oai-events");
        this.setupDataChannelListeners();
        
        // Start the session using the Session Description Protocol (SDP)
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        
        const baseUrl = "https://api.openai.com/v1/realtime";
        const model = "gpt-4o-realtime-preview-2024-12-17";
        
        const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${this.ephemeralKey}`,
            "Content-Type": "application/sdp"
          },
        });
        
        if (!sdpResponse.ok) {
          throw new Error(`Failed to connect: ${sdpResponse.status} ${sdpResponse.statusText}`);
        }
        
        const answer = {
          type: "answer",
          sdp: await sdpResponse.text(),
        };
        
        await this.pc.setRemoteDescription(answer);
        
        return true;
      } catch (error) {
        console.error("WebRTC initialization failed:", error);
        if (this.onStatusChange) this.onStatusChange('error', error.message);
        return false;
      }
    }
  
    setupDataChannelListeners() {
      this.dc.onopen = () => {
        console.log("Data channel opened");
        if (this.onStatusChange) this.onStatusChange('ready');
      };
  
      this.dc.onclose = () => {
        console.log("Data channel closed");
        if (this.onStatusChange) this.onStatusChange('disconnected');
      };
  
      this.dc.onerror = (error) => {
        console.error("Data channel error:", error);
        if (this.onStatusChange) this.onStatusChange('error', error.message);
      };
  
      this.dc.onmessage = (event) => {
        try {
          const realtimeEvent = JSON.parse(event.data);
          console.log("Received event:", realtimeEvent);
          
          if (realtimeEvent.type === "text.partial" || realtimeEvent.type === "text.final") {
            if (this.onTextEvent) {
              this.onTextEvent(realtimeEvent.text.content, realtimeEvent.type === "text.final");
            }
          }
        } catch (error) {
          console.error("Error processing message:", error);
        }
      };
    }
  
    async sendInstruction(instructions) {
      if (!this.dc || this.dc.readyState !== "open") {
        throw new Error("Data channel is not open");
      }
      
      this.currentInstructions = instructions;
      
      const responseCreate = {
        type: "response.create",
        response: {
          modalities: ["text", "audio"],
          instructions: instructions,
        },
      };
      
      this.dc.send(JSON.stringify(responseCreate));
    }
  
    async search(query) {
      try {
        const response = await fetch('http://127.0.0.1:5000/search', {
            method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ query })
        });
        
        if (!response.ok) {
          throw new Error(`Search failed: ${response.status}`);
        }
        
        return await response.json();
      } catch (error) {
        console.error("Search error:", error);
        return { error: error.message };
      }
    }
  
    async askQuestion(question) {
      try {
        if (!this.dc || this.dc.readyState !== "open") {
          throw new Error("WebRTC connection not established");
        }
        
        // First, search for the relevant information
        const searchResults = await this.search(question);
        
        let context = "I couldn't find specific information about that.";
        
        if (!searchResults.error && searchResults.results && searchResults.results.length > 0) {
          context = searchResults.results.map(result => 
            `From ${result.url}: ${result.content}`
          ).join("\n\n");
        }
        
        // Now, send the question and context to the assistant
        const instructions = `
          The user asked: "${question}"
          
          Here's what I found online:
          ${context}
          
          Please provide a helpful answer based on this information. If you can't find specific details about Sena services, you can share cricket results from March 9, 2025 instead.
        `;
        
        await this.sendInstruction(instructions);
        return true;
      } catch (error) {
        console.error("Error asking question:", error);
        if (this.onStatusChange) this.onStatusChange('error', error.message);
        return false;
      }
    }
  
    disconnect() {
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => track.stop());
        this.localStream = null;
      }
      
      if (this.dc) {
        this.dc.close();
        this.dc = null;
      }
      
      if (this.pc) {
        this.pc.close();
        this.pc = null;
      }
      
      if (this.audioElement) {
        this.audioElement.srcObject = null;
        this.audioElement = null;
      }
      
      if (this.onStatusChange) this.onStatusChange('disconnected');
    }
  }